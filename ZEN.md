# oh-my-pi-zen 维护规则

本仓库是 `can1357/oh-my-pi` 的 fork：`cagedbird043/oh-my-pi-zen`，工作分支 `zen/main`。
`zen/main` = 某个 upstream release tag + 一组 zen 补丁提交。本文件由 `.omp/config.yml` 的
`contextFiles.extra` 加载，与根目录 `AGENTS.md` 并列生效；upstream 规则仍然适用，冲突时以本文件为准。

## 分支与跟进

- `zen/main` 只建立在 upstream release tag 上，跟进新 tag 用 rebase，不 merge。
- upstream 的文件尽量不改；必须改的地方改动要小且集中，降低 rebase 冲突。
- zen 专属内容放在 upstream 没有的路径（如本文件、`.omp/config.yml`、`.github/workflows/zen-*.yml`）。
- upstream 的 workflow（`ci.yml`、`bun-cache-warm.yml`、`nix.yml`）在仓库设置里停用，文件不改。

## 提交组织

- 每个 zen 补丁是一个按主题划分的独立提交，提交信息用中文，带 `zen` 相关前缀便于识别。
- 修改已有补丁用 `git commit --fixup=<该补丁提交>`，再 `git rebase -i --autosquash <upstream tag>` 合并回去；
  不要在补丁之上堆叠零散的修补提交。
- 推送 `zen/main` 使用 `git push --force-with-lease`。
- 计划回馈上游的补丁先随 zen 发布自用；之后发现的问题都 fixup 回该补丁，用一段时间确认稳定后再整理成上游 PR。
  当前在此状态的：`feat(zen): 流式输出按行定稿…`（对应上游 #13676，含流式高亮漏复位码的 TS 修复）。

## 版本与发布

- 版本号 `X.Y.Z-zen.N`：`X.Y.Z` 是所基于的 upstream tag；同一 tag 上重新发布递增 `N`，跟进新 tag 从 `zen.1` 重计。
- 发布到 npm 的 `@oh-my-pi-zen/*`：所有 `@oh-my-pi/*` 子包改名后全量发布；zen 包之间的依赖写死精确版本，
  不用 `^`/`>=` 等范围（预发布版本不满足范围）；发布显式使用 `--tag latest`。
- natives 只发四个平台：`linux-x64`（自编，cargo feature `wayland-pipewire`）、`android-arm64`（NDK r30、API 28 交叉编译，bionic；最低 Android 9）、`darwin-arm64`、`linux-arm64`
  （后两者复用官方同版本 npm 包里的 `.node`）。addon 版本在链接后写入，必须与 `X.Y.Z-zen.N` 一致；Android 不提供桌面操作与系统剪贴板。
- Linux 的 PipeWire 运行库按需加载，缺库不得阻断普通 CLI；发布前运行 `bun scripts/zen/native-portability-smoke.ts /tmp/zen-publish`，在无 PipeWire/SPA 的隔离容器中验证实际 npm 包的加载、CLI 启动和捕获错误。
- 安装：`bun install -g @oh-my-pi-zen/pi-coding-agent`。

### npm 发布流程

- 触发 CI 发布前，必须先在本机完整演练 CI 的构建与暂存步骤，全部通过才能触发；CI 只用来发布，不用来发现问题：
  1. `bun check` 与 `bun scripts/zen/run-tests.ts`。
  2. 构建与 CI 兼容的 addon：linux-x64 addon 用 `cargo-zigbuild` 把 glibc 钉在 CI 的版本（`ubuntu-24.04` 为 2.39），宿主机 glibc 更新，直接构建的 addon 过不了可移植性冒烟：`RUSTFLAGS="-C target-cpu=x86-64-v3" CARGO_TARGET_DIR=/tmp/zen-zig-target cargo zigbuild -p pi-natives --profile ci --features wayland-pipewire --target x86_64-unknown-linux-gnu.2.39`，产物 `libpi_natives.so` 即 `pi_natives.linux-x64-modern.node`；android-arm64 addon 按 `android-addon` job 用本机 NDK 交叉构建（`cargo build -p pi-natives --profile ci --target aarch64-linux-android`）。
  3. 用这两个 addon 运行下面的 `prepare-publish-worktree.ts`，再对暂存树运行 `native-portability-smoke.ts`。
- 手动运行 `.github/workflows/zen-release.yml`，或由其他 workflow 通过 `gh workflow run zen-release.yml` 触发 `workflow_dispatch`；不随 push 发布。
- `zen_number` 指定 `N`；留空时查询 npm `latest`，同一 upstream 版本递增，否则从 `1` 开始。失败重跑时填写原 `N`，已存在的精确版本会跳过。
- `bun scripts/zen/resolve-version.ts [N]` 输出 upstream 与 zen 版本。
- `bun scripts/zen/prepare-publish-worktree.ts --version X.Y.Z-zen.N --output /tmp/zen-publish --linux-addon <带 pipewire 的 linux-x64 addon> --android-addon <android-arm64 addon>` 创建独立暂存树，接收 CI 并行构建的 Linux/Android addon，下载官方 arm64 addon、逐一盖章、改名、构建并用 `npm pack` 生成 tarball；源工作区不改名。
- `bun scripts/zen/ci-release-publish.ts /tmp/zen-publish` 使用 npm CLI ≥ 11.5，显式 `--tag latest --access public`。全部 18 个包通过 OIDC 发布，npm 子进程不带 token，使用独立的空 userconfig/globalconfig。暂存 manifest 的 `repository.url` 指向本 fork，与 provenance 来源一致。发布后 best-effort 请求 npmmirror 同步。
- 发布集合为 12 个 workspace 包（`pi-utils`、`pi-wire`、`omptype`、`pi-catalog`、`pi-ai`、`pi-natives`、`pi-tui`、`pi-mnemopi`、`snapcompact`、`omp-stats`、`pi-agent-core`、`pi-coding-agent`）、四个 native leaf、`collab-web` 静态包（仅生产构建与许可证，去掉 umami），以及 `collab-relay-linux-x64` leaf（二进制与 `source-hash`）。发现其他新增可发布 workspace 包时中止，先确认发布范围。打包按依赖顺序，发布并行，已存在的精确版本跳过。
- relay 源码在 `zen/collab-relay/`，零依赖、不进 workspace；暂存时用 `bun build --compile --target=bun-linux-x64-baseline` 注入版本（baseline 目标强制使用官方静态运行时，不依赖系统 ICU），`source-hash` 是构建 bundle 与 Bun 版本的 SHA256。
- `zen-follow.yml` 每小时或手动检查下一个 upstream release tag，rebase、测试后用 `ZEN_DEPLOY_KEY` 推送并触发发布；失败即停用，需手动检查后重新启用。
- zen 测试路径统一维护在 `scripts/zen/tests.txt`；本地及两个 workflow 都运行 `bun scripts/zen/run-tests.ts`。
