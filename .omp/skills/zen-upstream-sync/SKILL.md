---
name: zen-upstream-sync
description: Rebuild, validate, integrate, and release the Oh My Pi Zen downstream patch stack on a new upstream stable release tag. MUST use whenever updating, upgrading, rebasing, refreshing, or releasing Zen against upstream, including requests such as “update Zen,” “sync upstream,” “upgrade to vX.Y.Z,” or “publish the next Zen release.”
---

# Zen Upstream Sync

Rebuild the downstream stack from a verified upstream release tag. NEVER merge a new upstream commit into the old `zen/main` history.

## Invariants

- MUST use an upstream `vX.Y.Z` release tag as the baseline.
- NEVER use arbitrary `upstream/main` commits.
- MUST preserve the exact old `zen/main` head before rebuilding.
- NEVER move or delete an existing `zen/vX.Y.Z-zen.N` tag.
- MUST replay only live downstream behavior; drop upstreamed patches and old release bumps.
- MUST regenerate derived files against the new baseline.
- MUST verify source, native code, focused contracts, and a compiled binary.
- MUST obtain explicit approval before `--force-with-lease` or any other history replacement.
- NEVER use the release script's `--watch`; trigger publication without it and monitor only through Harness GitHub `run_watch`.
- MUST run the exact hosted CI test buckets locally before the first release tag, not merely focused tests plus `bun check`.

## Inputs

Resolve before editing:

- Target upstream release tag.
- Current `zen/main` SHA and published Zen version.
- Upstream and origin remotes.
- Existing immutable Zen tag or required `backup/<version>` archive ref.
- Temporary sync branch/worktree path.

## Phase 1: Preserve and verify

1. Fetch origin, upstream tags, and branch refs.
2. Verify the target tag exists on upstream and is a release tag.
3. Record target tag SHA; reject a moving or ambiguous ref.
4. Record exact `zen/main` SHA and current Zen version.
5. If an immutable release tag already points to that SHA, use it as the archive.
6. Otherwise create and push `backup/<current-zen-version>` at that SHA.
7. NEVER rename, delete, or rewrite `zen/main` during preparation.

## Phase 2: Inventory the downstream stack

Compare the archived Zen head with the target tag and classify every downstream commit:

- Zen release identity/workflow.
- Open upstream PR fixes not present in the target tag.
- Zen-only runtime features.
- Unicode Snapcompact.
- Docs/changelog wording.
- Generated-file refreshes.
- Old release bumps.
- Patches already merged upstream.

Drop old release bumps, obsolete generated output, and upstreamed patches. Keep the classification in replay order; do not cherry-pick by date alone.

## Phase 3: Rebuild from the stable tag

1. Create a clean feature branch and worktree from the target tag.
2. Replay live patches in this order:
   1. Zen release identity and workflow.
   2. Still-open upstream PR patches.
   3. Zen-only runtime features.
   4. Unicode Snapcompact.
   5. Docs and changelog wording.
   6. Generated-file refresh.
3. Resolve conflicts against current upstream APIs and tests. NEVER preserve stale code merely to match the old diff.
4. Search for conflict markers and replay damage such as literal `\t` indentation.
5. Keep source package names/imports as `@oh-my-pi/*`; publish rewriting remains in `scripts/zen/`.
6. Keep the release bump last and separate from the rebuilt patch stack.

## Phase 4: Regenerate and reconcile

Regenerate from the new baseline instead of copying old artifacts:

- Install the locked Bun dependencies.
- Refresh `MODULE.bazel.lock` with `bazel mod deps --lockfile_mode=update` when Bazel/Cargo inputs changed.
- Rebuild the host native addon before native-dependent tests.
- Run the Zen changelog recovery path so released Zen sections remain immutable and new live entries land under `[Unreleased]`.
- Reconcile new required fields, narrowed types, and provider interfaces at their source; NEVER add compatibility shims for removed upstream APIs.
- Format only touched files using project tooling.

### Native freshness gate

Native-dependent verification MUST use an addon rebuilt from the current branch. A matching version sentinel does not prove the addon contains newly added N-API exports.

1. Rebuild/install the host addon through the same Bazel path CI uses.
2. Load the resulting `.node` directly and verify:
   - expected version sentinel;
   - every newly required export (for example a new N-API class or method);
   - source loader resolves to that artifact, not a stale candidate.
3. Re-run native-dependent tests only after this check.
4. Treat worktree-local `.node` files and npm-downloaded fallback addons as stale until proven otherwise.
5. Refresh `MODULE.bazel.lock` after the final release version bump when Cargo/package versions affect Bazel inputs.

### Test isolation rules learned from release failures

- Temporary Git repositories MUST set `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`. User settings such as `core.fsmonitor=true` can corrupt split-index/worktree expectations.
- Tests requiring a specific available model MUST create an isolated `ModelRegistry` and explicitly provide that model. NEVER depend on process-global registry/auth state left by earlier tests.
- Network failure tests MUST inject deterministic `ReadableStream` events/errors. NEVER depend on raw TCP packet boundaries, write-versus-FIN timing, or a single `data` callback containing a complete HTTP request.
- Cross-process tests MUST use deterministic result transfer. Prefer synchronous argv spawning or an explicit result file when stdout/pipe completion can race the test runner.
- NEVER use `mock.module()`; its global module-registry effects leak across files.
- A test that passes alone but fails in its hosted bucket is not green. Reproduce the entire bucket before release.

Commit the reconciliation separately from replayed commits so future syncs can audit why adaptation was needed.

## Phase 5: Verify the rebuilt branch

Required gates, in order:

1. Focused contracts for every replayed downstream feature.
2. Zen release/release-note/native-version tests.
3. Changelog parsing and bundle-resource tests.
4. Fresh host native build and export check from the current branch.
5. Exact hosted test buckets, including the native/unit release gate:

   ```bash
   OMP_TEST_CONCURRENCY=4 OMP_TEST_CHUNK_TIMEOUT=1200 CI=1 \
     bun run ci:test:coding-agent:native
   ```

   Inspect `.github/workflows/ci.yml` and `scripts/ci-test-ts.ts` for any other changed or newly required buckets; run their exact commands and environment rather than approximating them with a broad test invocation.
6. Full repository checks:

   ```bash
   CMAKE_POLICY_VERSION_MINIMUM=3.5 CI=1 bun check
   CI=1 bun run ci:test:smoke
   ```

7. Host release binary build:

   ```bash
   PI_BINARY_BASENAME=omp-zen bun scripts/ci-release-build-binaries.ts --targets <host-target>
   ```

8. Compiled binary `--version` and `--smoke-test`.

`bun check` normally includes Rust validation; also run `CI=1 bun run check:rs` directly when Rust/native inputs changed or when isolating a failure.

### Pre-integration checklist

Every item MUST be true before replacing `zen/main`:

- [ ] Stable upstream release tag and exact SHA recorded.
- [ ] Old `zen/main` has a durable immutable tag or pushed backup ref.
- [ ] No conflict markers or replay damage such as literal `\t` indentation.
- [ ] `git diff --check` clean.
- [ ] Generated files and changelogs regenerated from the new baseline.
- [ ] Fresh Bazel/native addon loaded; sentinel and new exports verified.
- [ ] Focused downstream contracts green.
- [ ] Exact hosted CI buckets green, especially `ci:test:coding-agent:native`.
- [ ] Full `bun check` green.
- [ ] Compiled binary version and smoke green.
- [ ] No tracked build drift or accidental Bazel worktree symlink.

## Phase 6: Integrate safely

1. Preserve the verified sync-branch SHA.
2. Explain that replacing `zen/main` rewrites downstream history and is reversible through the archived release/backup ref.
3. Obtain explicit user approval for `--force-with-lease`.
4. Update `zen/main` to the verified SHA without creating a merge commit.
5. Push with an exact lease against the previously recorded remote `zen/main` SHA.
6. NEVER use plain `--force`.
7. Confirm remote `zen/main` equals the verified SHA.
8. Monitor every workflow for that exact SHA using Harness GitHub `run_watch`; fix real failures on the feature branch, re-run the exact failed bucket plus all required gates, and repeat integration only with a fresh lease.

## Phase 7: Release

Only after integrated `zen/main` CI is green:

1. Run `bun scripts/zen/release.ts next` (or the explicitly requested version) **without `--watch`**.
2. Confirm it performs the release bump last, updates package/Cargo/native sentinel versions, regenerates locks, finalizes changelogs, commits, tags, and pushes.
3. Use Harness GitHub `run_watch` for the release commit/run until every job has a terminal result. The script's built-in watcher and external `gh run watch` are prohibited.
4. Inspect the exact failed job log and reproduce its exact bucket/environment locally before changing code.
5. NEVER move an existing tag to repair a failed release. Preserve the failed `zen.N` tag, fix forward on `zen/main`, obtain green mainline CI, then publish `zen.(N+1)`.
6. A failure-only test stabilization MUST address its root cause: isolate global Git/settings/model state or replace timing-dependent fixtures. NEVER add sleeps, retries, or wider timeouts to hide it.

## Phase 8: Verify published artifacts

Verify independently; workflow-level `completed/success` is insufficient because an individual publish job can still appear in progress in a stale Harness snapshot:

- Re-run Harness `run_watch` until the release run and every listed job have terminal conclusions.
- GitHub release is Latest, its tag points to the release bump commit, and expected platform binaries/checksum manifest exist.
- Query npm registry directly for the primary package, native package, and every platform leaf at the exact version.
- Verify npm `latest` for the primary and native packages.
- Published package names are `@oh-my-pi-zen/*`; source names remain `@oh-my-pi/*`.
- Install the primary coding-agent package in a clean temporary environment.
- Run installed `omp --version` and `omp --smoke-test`.
- Confirm update metadata/distribution fields target the Zen repository and package.

Do not infer npm publication from a green workflow or GitHub Release alone.

## Phase 9: Cleanup

Cleanup only after publication verification:

- Remove temporary worktrees and short-lived sync branches.
- Remove ignored Bazel worktree symlinks/build artifacts created locally.
- Keep immutable release tags and required backup refs.
- Confirm the main checkout is on `zen/main`, clean, and matches origin.
- Report exact SHAs, tag/version, tests, CI runs, and artifact checks.

## Stop conditions

Stop and surface evidence when:

- The target is not a stable upstream release tag.
- The old `zen/main` head lacks a durable archive ref.
- Patch classification is ambiguous enough to change shipped behavior.
- Required verification fails.
- Remote `zen/main` moved since the recorded lease.
- Explicit history-rewrite approval is missing.

Never skip a failed gate to “finish” the release.
