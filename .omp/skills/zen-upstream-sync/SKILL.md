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

Commit the reconciliation separately from replayed commits so future syncs can audit why adaptation was needed.

## Phase 5: Verify the rebuilt branch

Required gates:

```bash
CMAKE_POLICY_VERSION_MINIMUM=3.5 CI=1 bun check
CI=1 bun run ci:test:smoke
```

Also run:

- Focused tests for every replayed downstream feature.
- Zen release/release-note/native-version tests.
- Changelog parsing and bundle-resource tests.
- `CI=1 bun run check:rs` when Rust/native inputs changed; `bun check` normally includes it.
- Host native build: `bun run build:native`.
- Host release binary build:
  `PI_BINARY_BASENAME=omp-zen bun scripts/ci-release-build-binaries.ts --targets <host-target>`.
- Compiled binary checks: `--version` and `--smoke-test`.

Before integration, require:

- No conflict markers.
- `git diff --check` clean.
- No tracked build/generated drift.
- Focused tests green.
- Full `bun check` green.
- Compiled binary smoke green.

## Phase 6: Integrate safely

1. Preserve the verified sync-branch SHA.
2. Explain that replacing `zen/main` rewrites downstream history and is reversible through the archived release/backup ref.
3. Obtain explicit user approval for `--force-with-lease`.
4. Update `zen/main` to the verified SHA without creating a merge commit.
5. Push with an exact lease against the previously recorded remote `zen/main` SHA.
6. NEVER use plain `--force`.
7. Confirm remote `zen/main` equals the verified SHA.
8. Watch all workflows for that SHA; fix real failures on the feature branch, re-run gates, and repeat integration only with a fresh lease.

## Phase 7: Release

Only after integrated `zen/main` CI is green:

1. Run the Zen release workflow for `next` (or the explicitly requested version).
2. Confirm it performs the release bump last, updates package/Cargo/native sentinel versions, regenerates locks, finalizes changelogs, commits, tags, and pushes.
3. Watch release CI to completion.
4. NEVER move an existing tag to repair a failed release. Fix forward and create the next valid release when required.

## Phase 8: Verify published artifacts

Verify independently, not only from CI status:

- GitHub release/tag points to the release bump commit.
- Expected platform binaries and checksum manifest exist.
- npm Zen packages expose the exact release version.
- Published package names are `@oh-my-pi-zen/*`; source names remain `@oh-my-pi/*`.
- Install or pack the primary coding-agent package in a clean temp directory.
- Run installed `omp --version` and `omp --smoke-test`.
- Confirm update metadata/distribution fields target the Zen repository and package.

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
