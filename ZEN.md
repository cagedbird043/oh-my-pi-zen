# oh-my-pi-zen 维护规则

本仓库是 `can1357/oh-my-pi` 的 fork：`cagedbird043/oh-my-pi-zen`，工作分支 `zen/main`。
`zen/main` = 某个 upstream release tag + 一组 zen 补丁提交。本文件由 `.omp/config.yml` 的
`contextFiles.extra` 加载，与根目录 `AGENTS.md` 并列生效；upstream 规则仍然适用，冲突时以本文件为准。

## 分支与跟进

- 跟进新 tag 要改写并强推 `zen/main`，随后发布。用户没有明确授权强推时，开工前先问一次，拿到授权后整个跟进流程（强推与发布）不再逐步确认，类似 `sudo -v` 预先取得授权。
- `zen/main` 只建立在 upstream release tag 上。手动跟进新 tag 时，记录旧基底 tag 和 `zen/main` 的旧 SHA，从旧 SHA 创建临时候选分支，在候选分支执行 `git rebase --onto <新tag> <旧tag>`。
- 跟进前列出旧 upstream tag 到 `zen/main` 的补丁清单，逐项确认保留、上游已覆盖或需要适配；验收前保留原 `zen/main` 不动。
- 每个补丁的冲突解决与适配归入该主题提交；用 `git range-diff <旧tag>..<旧SHA> <新tag>..<候选分支>` 对照清单核验补丁栈，并检查新 tag 之上的最终差异。完成测试、实际 smoke 和代码审查，验收通过再将 `zen/main` 指向候选结果，以记录的旧 SHA 为显式 lease 推送。
- 变基前先串行安装新 tag 的 `rust-toolchain.toml` 所需工具链、组件与 Android target，再并行构建，避免多个 rustup 同时首次安装同一工具链。
- 适配桌面输入与监控代码时，平台 cfg 要覆盖类型、字段、方法及调用方；Android 不提供桌面输入，必须用 NDK 交叉编译确认，不能只看 Linux 构建结果。
- 桌面冲突适配除 addon 构建外，还要运行原生 desktop 回归：测试夹具也会因窗口、能力或请求结构新增字段而失编。合并 AX 写入实现时保留 zen 的可见性/启用状态准入检查，以及上游的超时、取消和写后读回校验。
- 生成文件冲突先选择一侧作为可解析输入，再从合并后的源码重建：查看器用 `bun --cwd=packages/collab-web run gen:export-viewer --write`；规则用 `bun run gen:compat`；AnySearch 所在的模型目录用 `bun packages/catalog/scripts/generate-models.ts --provider web`，不重写其他 provider 的快照。
- 新增或修改 KDL 的 `seed` 模型后，除 `bun run gen:compat` 外，还要用 `bun packages/catalog/scripts/generate-models.ts --provider <provider>` 更新对应目录快照；仅编译规则不会让新增条目出现在启动时的内置目录中。
- upstream 的文件尽量不改；必须改的地方改动要小且集中，降低补丁适配冲突。
- zen 专属内容放在 upstream 没有的路径（如本文件、`.omp/config.yml`、`.github/workflows/zen-*.yml`）。
- upstream 的 workflow（`ci.yml`、`bun-cache-warm.yml`、`nix.yml`）在仓库设置里停用，文件不改。
- 本仓库的 `gh` 默认仓库设为本 fork（`gh repo set-default cagedbird043/oh-my-pi-zen`）；否则 `gh` 默认指向 upstream remote 的 `can1357/oh-my-pi`。新检出时先确认 `gh repo set-default --view`。

## 提交组织

- 格式化用仓库脚本：`bun run fmt`（TS 走 `oxfmt`，Rust 走 `bun run fmt:rs`），单个 TS 文件用 `bunx oxfmt <文件>`；不用 biome、prettier 等其他格式化器。
- 每个 zen 补丁按主题组织，提交信息用中文，带 `zen` 相关前缀便于识别。
- 平时迭代在栈顶新开提交，不 fixup 进底下的主题提交；已推送的中间状态保留，可以逐个回看和单独撤回。
- 补丁栈间歇性整理：手动跟进新 upstream tag 时，或用户要求整理时，才在 `git rebase -i <upstream tag>` 里按主题把迭代提交 squash/fixup 进各自的主题提交。
- fixup 前先确认目标提交：用 `git log -S'<改动涉及的内容>' <upstream tag>..HEAD -- <文件>` 或 `git blame` 找到真正引入那段内容的主题提交；目标提交里还没有该文件时不能 fixup 进去。
- 整理补丁栈前记录旧 SHA；整理后 `git diff <旧SHA> HEAD` 只能出现有意的改动，并用 `git rebase <upstream tag> -x 'bun check'` 确认每个提交都能单独通过检查。
- 改写过历史的推送一律用带明确旧值的租约：`git push --force-with-lease=zen/main:<旧SHA> origin HEAD:refs/heads/zen/main`；普通追加提交直接快进推送。
- 计划回馈上游的补丁先随 zen 发布自用；之后的修正同样先在栈顶新开提交，间歇性整理时并回该补丁，用一段时间确认稳定后再整理成上游 PR。
  当前在此状态的：`feat(zen): 流式输出按行定稿…`（对应上游 #13676，含流式高亮漏复位码的 TS 修复）。

## 版本与发布

- 版本号 `X.Y.Z-zen.N`：`X.Y.Z` 是所基于的 upstream tag；同一 tag 上重新发布递增 `N`，跟进新 tag 从 `zen.1` 重计。
- 发布到 npm 的 `@oh-my-pi-zen/*`：所有 `@oh-my-pi/*` 子包改名后全量发布；zen 包之间的依赖写死精确版本，
  不用 `^`/`>=` 等范围（预发布版本不满足范围）；发布显式使用 `--tag latest`。
- natives 发布 `linux-x64`、`win32-x64`、`android-arm64`（NDK r30、API 28；最低 Android 9）、`darwin-arm64` 和 `linux-arm64`。后两者复用官方同版本的 `.node`。Windows x64 addon 由 GitHub 托管的 `windows-2025` runner 编译，所有 addon 在暂存时盖章为同一 Zen 版本。Android 不提供桌面操作与系统剪贴板。
- Linux 的 PipeWire 运行库按需加载，缺库不得阻断普通 CLI；发布前运行 `bun scripts/zen/native-portability-smoke.ts /tmp/zen-publish`，在无 PipeWire/SPA 的隔离容器中验证实际 npm 包的加载、CLI 启动和捕获错误。
- 安装：`bun install -g @oh-my-pi-zen/pi-coding-agent`。安装前确认目标平台 native leaf 的精确版本已在 `https://registry.npmjs.org` 可获取。若 Bun 曾将尚未可用的 leaf 跳过并记入全局 lockfile，待其可用后先 `bun remove -g @oh-my-pi-zen/pi-coding-agent`，再 `bun add -g @oh-my-pi-zen/pi-coding-agent@<版本>`。

### npm 发布流程

- 触发 CI 发布前，在本机演练可执行的构建、暂存和冒烟步骤。Windows x64 的 MSVC 构建由 GitHub 托管 runner 在发布前验证。
  1. `bun check` 与 `bun scripts/zen/run-tests.ts`。
  2. 构建与 CI 兼容的 addon：linux-x64 addon 用 `cargo-zigbuild` 把 glibc 钉在 CI 的版本（`ubuntu-24.04` 为 2.39），宿主机 glibc 更新，直接构建的 addon 过不了可移植性冒烟：`RUSTFLAGS="-C target-cpu=x86-64-v3" CARGO_TARGET_DIR=/tmp/zen-zig-target cargo zigbuild -p omp-natives --profile ci --target x86_64-unknown-linux-gnu.2.39`，产物 `libpi_natives.so` 即 `pi_natives.linux-x64-modern.node`；android-arm64 addon 按 `android-addon` job 用本机 NDK 交叉构建（`cargo build -p omp-natives --profile ci --target aarch64-linux-android`）。
  3. 用 Linux、Android addon 和已有的 Windows x64 构建产物演练 npm 暂存，对暂存树运行 `native-portability-smoke.ts`。
- 手动运行 `.github/workflows/zen-release.yml`，或由其他 workflow 通过 `gh workflow run zen-release.yml` 触发 `workflow_dispatch`；不随 push 发布。
- `zen_number` 指定 `N`；留空时查询 npm `latest`，同一 upstream 版本递增，否则从 `1` 开始。失败重跑时填写原 `N`，已存在的精确版本会跳过。
- `bun scripts/zen/resolve-version.ts [N]` 输出 upstream 与 zen 版本。
- `bun scripts/zen/prepare-publish-worktree.ts` 在独立目录内生成发布所用的 tarball 与发布清单。所需 addon 参数见命令的用法提示。
- npm 发布使用 `zen-release.yml` 的 OIDC 授权。启用 Windows x64 发布前，确认 `@oh-my-pi-zen/pi-natives-win32-x64` 的可信发布者允许 `cagedbird043/oh-my-pi-zen` 的 `zen-release.yml` 直接发布。
- 发布集合由 `scripts/zen/release.ts` 定义。已存在的精确版本会跳过。
- relay 源码在 `zen/collab-relay/`，零依赖、不进 workspace；暂存时用 `bun build --compile --target=bun-linux-x64-baseline` 注入版本（baseline 目标强制使用官方静态运行时，不依赖系统 ICU），`source-hash` 是构建 bundle 与 Bun 版本的 SHA256。
- `zen-follow.yml` 每小时或手动检查下一个 upstream release tag，rebase、测试后用 `ZEN_DEPLOY_KEY` 推送并触发发布；失败即停用，需手动检查后重新启用。
- zen 测试路径统一维护在 `scripts/zen/tests.txt`；本地及两个 workflow 都运行 `bun scripts/zen/run-tests.ts`。
