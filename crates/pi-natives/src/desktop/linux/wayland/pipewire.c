// PipeWire/SPA headers describe the ABI; no PipeWire library is linked here.
// All callbacks run synchronously in omp_pw_iterate (not RT_PROCESS).
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pipewire/pipewire.h>
#include <spa/param/video/format-utils.h>
#include <spa/pod/builder.h>

#define PW_FUNCTIONS(X) \
    X(pw_init) \
    X(pw_main_loop_new) \
    X(pw_main_loop_destroy) \
    X(pw_main_loop_get_loop) \
    X(pw_context_new) \
    X(pw_context_destroy) \
    X(pw_context_connect_fd) \
    X(pw_core_disconnect) \
    X(pw_properties_new_dict) \
    X(pw_stream_new) \
    X(pw_stream_destroy) \
    X(pw_stream_add_listener) \
    X(pw_stream_connect) \
    X(pw_stream_dequeue_buffer) \
    X(pw_stream_queue_buffer)

#define DECLARE(name) __typeof__(&name) name;
static struct { PW_FUNCTIONS(DECLARE) } api;
#undef DECLARE

// Called once by Rust's LazyLock. The successful handle is process-lived:
// PipeWire can retain internal state and callbacks until process exit.
int omp_pw_load(char *error, size_t capacity) {
    void *library = dlopen("libpipewire-0.3.so.0", RTLD_NOW | RTLD_LOCAL);
    if (!library) {
        snprintf(error, capacity, "libpipewire-0.3.so.0: %s", dlerror());
        return -1;
    }
#define RESOLVE(name) do { \
    dlerror(); \
    api.name = (__typeof__(api.name))dlsym(library, #name); \
    const char *detail = dlerror(); \
    if (detail || !api.name) { \
        snprintf(error, capacity, "libpipewire-0.3.so.0: missing symbol %s (%s)", \
                 #name, detail ? detail : "null address"); \
        dlclose(library); \
        return -1; \
    } \
} while (0);
    PW_FUNCTIONS(RESOLVE)
#undef RESOLVE
    api.pw_init(NULL, NULL);
    return 0;
}

// Shared with PipeWireFrame in capture.rs. Format codes are our bridge ABI,
// not the host SPA enum: 1 RGB, 2 BGR, 3 RGBA, 4 RGBx, 5 BGRA, 6 BGRx.
struct omp_pw_frame {
    const unsigned char *data;
    size_t length;
    uint32_t width, height, format, offset, size;
    int32_t stride;
};
typedef void (*frame_callback)(void *, const struct omp_pw_frame *);

struct omp_pw_session {
    struct pw_main_loop *mainloop;
    struct pw_context *context;
    struct pw_core *core;
    struct pw_stream *stream;
    struct spa_hook listener;
    struct spa_video_info_raw format;
    frame_callback callback;
    void *userdata;
    char error[512];
};

void omp_pw_close(struct omp_pw_session *session) {
    if (!session) return;
    if (session->stream) {
        spa_hook_remove(&session->listener);
        api.pw_stream_destroy(session->stream);
    }
    if (session->core) api.pw_core_disconnect(session->core);
    if (session->context) api.pw_context_destroy(session->context);
    if (session->mainloop) api.pw_main_loop_destroy(session->mainloop);
    free(session);
}

static void on_state_changed(void *data, enum pw_stream_state old,
                             enum pw_stream_state state, const char *error) {
    (void)old;
    struct omp_pw_session *session = data;
    if (state == PW_STREAM_STATE_ERROR)
        snprintf(session->error, sizeof(session->error), "PipeWire stream: %s",
                 error ? error : "unknown error");
}

static void on_param_changed(void *data, uint32_t id, const struct spa_pod *param) {
    struct omp_pw_session *session = data;
    if (param && id == SPA_PARAM_Format) {
        uint32_t media_type, media_subtype;
        if (spa_format_parse(param, &media_type, &media_subtype) < 0 ||
            media_type != SPA_MEDIA_TYPE_video || media_subtype != SPA_MEDIA_SUBTYPE_raw ||
            spa_format_video_raw_parse(param, &session->format) < 0)
            snprintf(session->error, sizeof(session->error), "PipeWire negotiated an invalid video format");
    }
}

static void on_process(void *data) {
    struct omp_pw_session *session = data;
    struct pw_buffer *buffer = api.pw_stream_dequeue_buffer(session->stream);
    if (!buffer) return;
    struct spa_buffer *spa = buffer->buffer;
    if (spa && spa->n_datas && spa->datas[0].chunk) {
        const struct spa_data *pixels = &spa->datas[0];
        uint32_t format = 0;
        switch (session->format.format) {
            case SPA_VIDEO_FORMAT_RGB: format = 1; break;
            case SPA_VIDEO_FORMAT_BGR: format = 2; break;
            case SPA_VIDEO_FORMAT_RGBA: format = 3; break;
            case SPA_VIDEO_FORMAT_RGBx: format = 4; break;
            case SPA_VIDEO_FORMAT_BGRA: format = 5; break;
            case SPA_VIDEO_FORMAT_BGRx: format = 6; break;
            default: break;
        }
        const struct omp_pw_frame frame = {
            .data = pixels->data, .length = pixels->maxsize,
            .width = session->format.size.width, .height = session->format.size.height,
            .format = format, .offset = pixels->chunk->offset,
            .size = pixels->chunk->size, .stride = pixels->chunk->stride,
        };
        session->callback(session->userdata, &frame);
    }
    api.pw_stream_queue_buffer(session->stream, buffer);
}

static const struct pw_stream_events events = {
    .version = PW_VERSION_STREAM_EVENTS,
    .state_changed = on_state_changed,
    .param_changed = on_param_changed,
    .process = on_process,
};

// Takes ownership of fd on every path, including allocation/creation failures.
struct omp_pw_session *omp_pw_open(uint32_t node, int fd, frame_callback callback,
                                   void *userdata, char *error, size_t capacity) {
    const char *stage = "session allocation";
    struct omp_pw_session *session = calloc(1, sizeof(*session));
    if (!session) goto failed;
    session->callback = callback;
    session->userdata = userdata;
    stage = "main loop";
    session->mainloop = api.pw_main_loop_new(NULL);
    if (!session->mainloop) goto failed;
    stage = "context";
    session->context = api.pw_context_new(api.pw_main_loop_get_loop(session->mainloop), NULL, 0);
    if (!session->context) goto failed;
    stage = "remote";
    // PipeWire closes this fd on disconnect or connection error.
    session->core = api.pw_context_connect_fd(session->context, fd, NULL, 0);
    fd = -1;
    if (!session->core) goto failed;
    stage = "stream properties";
    const struct spa_dict_item items[] = {
        { PW_KEY_MEDIA_TYPE, "Video" },
        { PW_KEY_MEDIA_CATEGORY, "Capture" },
        { PW_KEY_MEDIA_ROLE, "Screen" },
    };
    const struct spa_dict properties = SPA_DICT_INIT(items, 3);
    struct pw_properties *props = api.pw_properties_new_dict(&properties);
    if (!props) goto failed;
    stage = "stream";
    session->stream = api.pw_stream_new(session->core, "omp-computer-capture", props);
    if (!session->stream) goto failed;
    api.pw_stream_add_listener(session->stream, &session->listener, &events, session);
    unsigned char bytes[1024];
    struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(bytes, sizeof(bytes));
    const struct spa_pod *params[] = {
        spa_pod_builder_add_object(&builder,
            SPA_TYPE_OBJECT_Format, SPA_PARAM_EnumFormat,
            SPA_FORMAT_mediaType, SPA_POD_Id(SPA_MEDIA_TYPE_video),
            SPA_FORMAT_mediaSubtype, SPA_POD_Id(SPA_MEDIA_SUBTYPE_raw),
            SPA_FORMAT_VIDEO_format, SPA_POD_CHOICE_ENUM_Id(7,
                SPA_VIDEO_FORMAT_BGRx, SPA_VIDEO_FORMAT_BGRx, SPA_VIDEO_FORMAT_BGRA,
                SPA_VIDEO_FORMAT_RGBx, SPA_VIDEO_FORMAT_RGBA, SPA_VIDEO_FORMAT_RGB, SPA_VIDEO_FORMAT_BGR),
            SPA_FORMAT_VIDEO_size, SPA_POD_CHOICE_RANGE_Rectangle(
                &SPA_RECTANGLE(1920, 1080), &SPA_RECTANGLE(1, 1), &SPA_RECTANGLE(16384, 16384)))
    };
    stage = "connect";
    int result = api.pw_stream_connect(session->stream, SPA_DIRECTION_INPUT, node,
                                      PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS, params, 1);
    if (result < 0) {
        errno = -result;
        goto failed;
    }
    return session;
failed:
    snprintf(error, capacity, "PipeWire %s: %s", stage, strerror(errno));
    if (fd >= 0) close(fd);
    omp_pw_close(session);
    return NULL;
}

int omp_pw_iterate(struct omp_pw_session *session, int timeout, char *error, size_t capacity) {
    struct pw_loop *loop = api.pw_main_loop_get_loop(session->mainloop);
    pw_loop_enter(loop);
    int result = pw_loop_iterate(loop, timeout);
    pw_loop_leave(loop);
    if (session->error[0]) {
        snprintf(error, capacity, "%s", session->error);
        return -1;
    }
    if (result < 0)
        snprintf(error, capacity, "PipeWire loop: %s", strerror(-result));
    return result;
}
