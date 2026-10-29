use std::{
	ffi::{CStr, c_char, c_int, c_void},
	os::fd::{IntoRawFd, OwnedFd},
	ptr::NonNull,
	sync::LazyLock,
	time::{Duration, Instant},
};

use ashpd::desktop::{
	PersistMode, Session,
	screencast::{CursorMode, Screencast, SourceType},
};
use image::RgbaImage;

use super::portal::{read_token, store_token};
use crate::desktop::{
	control,
	error::{CoreResult, DesktopError},
};

const SCREENCAST_TOKEN: &str = "screencast-token";
const PORTAL_TIMEOUT: Duration = Duration::from_secs(30);
const FRAME_TIMEOUT: Duration = Duration::from_secs(5);

struct ScreenCast {
	node:     u32,
	fd:       OwnedFd,
	position: Option<(i32, i32)>,
	size:     Option<(i32, i32)>,
	session:  Session<'static, Screencast<'static>>,
}

struct CapturedFrame {
	image:  Option<RgbaImage>,
	width:  u32,
	height: u32,
}

async fn portal_request<T>(request: impl Future<Output = Result<T, String>>) -> CoreResult<T> {
	super::libei::cancellable(tokio::time::timeout(PORTAL_TIMEOUT, request))
		.await?
		.map_err(|_| DesktopError::capture_failed("Wayland ScreenCast portal timed out"))?
		.map_err(DesktopError::capture_failed)
}

async fn open_screencast() -> CoreResult<ScreenCast> {
	let portal = portal_request(async {
		Screencast::new()
			.await
			.map_err(|err| format!("ScreenCast portal: {err}"))
	})
	.await?;
	let session = portal_request(async {
		portal
			.create_session()
			.await
			.map_err(|err| format!("ScreenCast CreateSession: {err}"))
	})
	.await?;
	let opened = portal_request(async {
		let restore_token = read_token(SCREENCAST_TOKEN);
		portal
			.select_sources(
				&session,
				CursorMode::Embedded,
				SourceType::Monitor.into(),
				true,
				restore_token.as_deref(),
				PersistMode::ExplicitlyRevoked,
			)
			.await
			.map_err(|err| format!("ScreenCast SelectSources: {err}"))?;
		let response = portal
			.start(&session, None)
			.await
			.map_err(|err| format!("ScreenCast Start: {err}"))?
			.response()
			.map_err(|err| format!("ScreenCast permission: {err}"))?;
		store_token(SCREENCAST_TOKEN, response.restore_token());
		let stream = response
			.streams()
			.first()
			.ok_or_else(|| "ScreenCast returned no monitor stream".to_string())?;
		let node = stream.pipe_wire_node_id();
		let position = stream.position();
		let size = stream.size();
		let fd = portal
			.open_pipe_wire_remote(&session)
			.await
			.map_err(|err| format!("ScreenCast OpenPipeWireRemote: {err}"))?;
		Ok((node, fd, position, size))
	})
	.await;
	match opened {
		Ok((node, fd, position, size)) => Ok(ScreenCast { node, fd, position, size, session }),
		Err(error) => {
			let _ = tokio::time::timeout(crate::desktop::CLOSE_TIMEOUT, session.close()).await;
			Err(error)
		},
	}
}

// ABI shared with pipewire.c. Callbacks run only during omp_pw_iterate,
// and the mapped bytes remain valid until that callback returns.
#[repr(C)]
struct PipeWireFrame {
	data:   *const u8,
	length: usize,
	width:  u32,
	height: u32,
	format: u32,
	offset: u32,
	size:   u32,
	stride: i32,
}

unsafe extern "C" {
	fn omp_pw_load(error: *mut c_char, capacity: usize) -> c_int;
	fn omp_pw_open(
		node: u32,
		fd: c_int,
		callback: unsafe extern "C" fn(*mut c_void, *const PipeWireFrame),
		userdata: *mut c_void,
		error: *mut c_char,
		capacity: usize,
	) -> *mut c_void;
	fn omp_pw_close(session: *mut c_void);
	fn omp_pw_iterate(
		session: *mut c_void,
		timeout: c_int,
		error: *mut c_char,
		capacity: usize,
	) -> c_int;
}

struct PipeWireSession(NonNull<c_void>);

impl Drop for PipeWireSession {
	fn drop(&mut self) {
		// SAFETY: this guard exclusively owns the session returned by
		// omp_pw_open; destruction removes the listener before freeing its
		// userdata references.
		unsafe { omp_pw_close(self.0.as_ptr()) };
	}
}

fn bridge_error(error: &[c_char]) -> String {
	// SAFETY: every bridge error path writes a NUL-terminated bounded string.
	unsafe { CStr::from_ptr(error.as_ptr()) }
		.to_string_lossy()
		.into_owned()
}

fn ensure_pipewire() -> CoreResult<()> {
	static LOADED: LazyLock<Result<(), String>> = LazyLock::new(|| {
		let mut error = [0; 1024];
		// SAFETY: the writable buffer has the supplied capacity; LazyLock
		// serializes symbol resolution/initialization and keeps the
		// successful library loaded.
		if unsafe { omp_pw_load(error.as_mut_ptr(), error.len()) } == 0 {
			Ok(())
		} else {
			Err(format!(
				"Wayland screen capture could not load the PipeWire runtime: {}. Install the runtime \
				 if missing (Debian 13/Ubuntu 24.04: sudo apt install libpipewire-0.3-0t64; Arch \
				 Linux: sudo pacman -S pipewire), or repair the incompatible library indicated by the \
				 loader error, then restart omp. Other CLI features do not require PipeWire.",
				bridge_error(&error)
			))
		}
	});
	LOADED
		.as_ref()
		.map_err(|error| DesktopError::capture_failed(error.clone()))
		.copied()
}

pub(super) fn available() -> bool {
	ensure_pipewire().is_ok()
}

fn rgba_from_buffer(frame: &PipeWireFrame, source: &[u8]) -> Result<RgbaImage, String> {
	let PipeWireFrame { width, height, offset, size, stride, .. } = *frame;
	if width == 0 || height == 0 {
		return Err("PipeWire negotiated an empty frame".to_string());
	}
	let offset = offset as usize;
	let bytes = size as usize;
	if stride <= 0 {
		return Err(format!("PipeWire returned unsupported frame stride {stride}"));
	}
	let stride = stride as usize;
	let end = offset
		.checked_add(bytes)
		.ok_or_else(|| "PipeWire frame size overflow".to_string())?
		.min(source.len());
	let source = source
		.get(offset..end)
		.ok_or_else(|| "PipeWire frame offset is outside the mapped buffer".to_string())?;
	let pixel_size = match frame.format {
		1 | 2 => 3,
		3..=6 => 4,
		other => return Err(format!("PipeWire negotiated unsupported pixel format {other}")),
	};
	let row_bytes = (width as usize)
		.checked_mul(pixel_size)
		.ok_or_else(|| "PipeWire row size overflow".to_string())?;
	if stride < row_bytes || source.len() < stride.saturating_mul(height as usize) {
		return Err(format!(
			"PipeWire frame buffer is short: {} bytes for {width}x{height} stride {stride}",
			source.len()
		));
	}
	let mut rgba = vec![
		0;
		(width as usize)
			.saturating_mul(height as usize)
			.saturating_mul(4)
	];
	for y in 0..height as usize {
		control::check().map_err(|error| error.to_string())?;
		let row = &source[y * stride..y * stride + row_bytes];
		for x in 0..width as usize {
			let input = &row[x * pixel_size..];
			let output = &mut rgba[(y * width as usize + x) * 4..];
			match frame.format {
				1 | 3 | 4 => {
					output[..4].copy_from_slice(&[
						input[0],
						input[1],
						input[2],
						if frame.format == 3 { input[3] } else { 255 },
					]);
				},
				_ => output[..4].copy_from_slice(&[
					input[2],
					input[1],
					input[0],
					if frame.format == 5 { input[3] } else { 255 },
				]),
			}
		}
	}
	RgbaImage::from_raw(width, height, rgba)
		.ok_or_else(|| "failed to construct PipeWire RGBA frame".to_string())
}

struct CaptureState {
	pixels: bool,
	result: Option<CoreResult<CapturedFrame>>,
}

unsafe extern "C" fn receive_frame(userdata: *mut c_void, frame: *const PipeWireFrame) {
	// SAFETY: grab_pipewire_frame lends its live state to the session. The C
	// bridge calls back synchronously with a valid frame and mapped buffer.
	let (state, frame) = unsafe { (&mut *userdata.cast::<CaptureState>(), &*frame) };
	if state.result.is_some() {
		return;
	}
	state.result = Some(if frame.width == 0 || frame.height == 0 {
		Err(DesktopError::capture_failed("PipeWire negotiated an empty frame"))
	} else if !state.pixels {
		Ok(CapturedFrame { image: None, width: frame.width, height: frame.height })
	} else if frame.data.is_null() {
		Err(DesktopError::capture_failed("PipeWire frame buffer is not memory-mapped"))
	} else {
		// SAFETY: the bridge exposes maxsize mapped bytes for this callback only.
		let bytes = unsafe { std::slice::from_raw_parts(frame.data, frame.length) };
		rgba_from_buffer(frame, bytes)
			.map(|image| CapturedFrame {
				image:  Some(image),
				width:  frame.width,
				height: frame.height,
			})
			.map_err(DesktopError::capture_failed)
	});
}

fn grab_pipewire_frame(node: u32, fd: OwnedFd, pixels: bool) -> CoreResult<CapturedFrame> {
	control::check()?;
	let mut state = CaptureState { pixels, result: None };
	let mut error = [0; 1024];
	// SAFETY: ensure_pipewire has resolved every bridge symbol before the portal
	// opens. The bridge consumes fd even on error. State stays live and at the
	// same address until the session (declared afterwards) is destroyed.
	let session = unsafe {
		omp_pw_open(
			node,
			fd.into_raw_fd(),
			receive_frame,
			std::ptr::from_mut(&mut state).cast(),
			error.as_mut_ptr(),
			error.len(),
		)
	};
	let session = PipeWireSession(
		NonNull::new(session).ok_or_else(|| DesktopError::capture_failed(bridge_error(&error)))?,
	);
	let deadline = Instant::now() + FRAME_TIMEOUT;
	loop {
		control::check()?;
		if let Some(result) = state.result.take() {
			return result;
		}
		if Instant::now() >= deadline {
			return Err(DesktopError::capture_failed("PipeWire frame timed out"));
		}
		// SAFETY: the guard owns a live session; callbacks borrow state only for
		// this call, and the error buffer has the supplied writable capacity.
		if unsafe { omp_pw_iterate(session.0.as_ptr(), 10, error.as_mut_ptr(), error.len()) } < 0 {
			return Err(DesktopError::capture_failed(bridge_error(&error)));
		}
	}
}

fn capture_stream(pixels: bool) -> CoreResult<(CapturedFrame, super::PortalGeometry)> {
	control::check()?;
	ensure_pipewire()?;
	let runtime = super::portal::portal_runtime()?;
	let ScreenCast { node, fd, position, size, session } = runtime.block_on(open_screencast())?;
	let captured = grab_pipewire_frame(node, fd, pixels);
	let _ = runtime.block_on(async {
		tokio::time::timeout(crate::desktop::CLOSE_TIMEOUT, session.close()).await
	});
	control::check()?;
	let captured = captured?;
	let geometry = super::PortalGeometry::new(position, size, captured.width, captured.height);
	Ok((captured, geometry))
}

pub(super) fn capture() -> CoreResult<(RgbaImage, super::PortalGeometry)> {
	let (frame, geometry) = capture_stream(true)?;
	let image = frame
		.image
		.ok_or_else(|| DesktopError::internal("PipeWire capture omitted pixels"))?;
	Ok((image, geometry))
}

pub(super) fn geometry() -> CoreResult<super::PortalGeometry> {
	capture_stream(false).map(|(_, geometry)| geometry)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn cancelled_geometry_refresh_never_opens_a_portal_session() {
		let source = control::CancellationSource::default();
		let token = source.token();
		source.cancel();
		let result = control::with_token_for_test(&token, geometry);
		assert_eq!(result.unwrap_err().code, token.check().unwrap_err().code);
	}

	#[test]
	fn pipewire_formats_preserve_channels_and_only_real_alpha() {
		for (format, bytes, expected) in [
			(1, vec![11, 22, 33], vec![11, 22, 33, 255]),
			(2, vec![33, 22, 11], vec![11, 22, 33, 255]),
			(3, vec![11, 22, 33, 44], vec![11, 22, 33, 44]),
			(4, vec![11, 22, 33, 0], vec![11, 22, 33, 255]),
			(5, vec![33, 22, 11, 44], vec![11, 22, 33, 44]),
			(6, vec![33, 22, 11, 0], vec![11, 22, 33, 255]),
		] {
			let frame = PipeWireFrame {
				data: bytes.as_ptr(),
				length: bytes.len(),
				width: 1,
				height: 1,
				format,
				offset: 0,
				size: bytes.len() as u32,
				stride: bytes.len() as i32,
			};
			assert_eq!(rgba_from_buffer(&frame, &bytes).unwrap().into_raw(), expected);
		}
	}

	#[test]
	fn pipewire_rows_respect_chunk_offset_padding_and_mapping_bounds() {
		let bytes = [99, 1, 2, 3, 99, 4, 5, 6, 99];
		let mut frame = PipeWireFrame {
			data:   bytes.as_ptr(),
			length: bytes.len(),
			width:  1,
			height: 2,
			format: 1,
			offset: 1,
			size:   8,
			stride: 4,
		};
		assert_eq!(rgba_from_buffer(&frame, &bytes).unwrap().into_raw(), vec![
			1, 2, 3, 255, 4, 5, 6, 255
		]);
		frame.size = 7;
		assert!(
			rgba_from_buffer(&frame, &bytes).is_err(),
			"short chunks cannot be read as full rows"
		);
		frame.offset = 10;
		assert!(
			rgba_from_buffer(&frame, &bytes).is_err(),
			"offsets outside the mapping are rejected"
		);
	}
}
