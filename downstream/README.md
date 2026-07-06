# Oh My Pi Zen Downstream Notes

Oh My Pi Zen is a downstream distribution of upstream Oh My Pi. It carries a small, explicit patch stack for dogfooding, provider ergonomics, and release tooling while keeping generally useful fixes available as upstream PRs.

## Branch taxonomy

- `zen/main`: integrated downstream branch. This is the branch used for dogfooding-ready integration and Zen releases; do not use it for early experiments.
- `upstream-pr/*`: patches intended for upstream Oh My Pi. Keep these branches clean and reviewable; existing GitHub PR head branches may keep their historical names when GitHub cannot rename them in place.
- short-lived feature branches: temporary Zen experiments and dogfood branches. Delete them after squash-merging into `zen/main`.
- `main`: upstream mirror compatibility branch. Do not use it as the Zen integration branch.

Current upstream PR branches:

- `upstream-pr/anysearch-provider`: AnySearch web search provider support. Existing upstream PR: `can1357/oh-my-pi#3723`; historical PR head: `feat/anysearch-provider`.
- `upstream-pr/gemini-thinking-loop-guard`: Gemini / Cloud Code Assist hidden-thinking-summary plumbing. Existing upstream PR: `can1357/oh-my-pi#4400`; historical PR head: `fix/gemini-loop-guard-prose-default`.
- `upstream-pr/quota-insufficient-usage-limit`: provider gateway quota error classification. Existing upstream PR: `can1357/oh-my-pi#4575`.

## Patch-stack rules

- Prefer `upstream-pr/*` for general fixes that should benefit upstream users.
- Use short-lived feature branches for Zen-only behavior, local dogfood workflows, provider gateway compatibility, and downstream release engineering.
- Do not experiment directly on `zen/main`; merge into `zen/main` only after the feature has been dogfooded and verified.
- Squash-merge feature branches into one coherent commit on `zen/main`, then delete the feature branch.
- Avoid force-pushing `zen/main` for ordinary development. Use branch work plus squash integration instead; reserve `zen/main` rewrites for history cleanup before shared use or explicit maintenance decisions.
- When upstream merges a PR, remove the duplicate downstream patch from `zen/main` during the next rebase/reconciliation.

## Source and publish identity

The editable source tree intentionally keeps upstream package identity:

```text
@oh-my-pi/*
```

Zen identity is applied only when building publish/install worktrees:

```text
@oh-my-pi-zen/*
```

This keeps upstream rebases, cherry-picks, and `upstream-pr/*` branches small. Do not rename source package names or internal imports to Zen scope during normal development; update `scripts/zen/package-map.ts` if publish identity rewriting needs to change.

## Dogfood install

Use the local installer when testing unreleased Zen changes on this machine:

```sh
bun run zen:install-local
```

For an already-built tree:

```sh
bun run zen:install-local -- --skip-build
```

The installer:

- builds `packages/natives` and `packages/coding-agent` unless `--skip-build` is passed;
- backs up existing `~/.bun/bin/omp` and `~/.bun/bin/omp-zen` into `~/.bun/bin/omp-backups/`;
- atomically installs the built binary as both `omp` and `omp-zen`;
- clears the matching native cache under `~/.omp/natives/<version>`;
- runs `--version` and `--smoke-test` for both binaries.

## Release policy

- Dogfood first; release only after local use confirms the behavior.
- Zen versions follow the distro-style format `<upstreamVersion>-zen.N`, for example `16.3.6-zen.4`.
- Same upstream base increments `zen.N`; a new upstream base resets the counter, for example `16.3.7-zen.1`.
- Supported binary targets are `linux-x64`, `linux-arm64`, and `darwin-arm64`.
- Windows and macOS x64 are not Zen release targets.

## User-visible Zen patches

Current dogfood patch stack includes:

- `unicode-snapcompact`: zpix-backed visual archive compaction for Unicode/CJK long-session memory, with quality/density presets under `snapcompact.unicodeShape`;
- ordered model role fallback chains: `modelRoles.default: a,b,c` means `a -> b -> c` at runtime;
- model selector chain badges such as `DEFAULT#0`, `DEFAULT#1`, and `TASK#0`;
- status-line provider visibility for values like `codez/GPT-5.5`;
- quota/usage-limit detection for gateway errors including Chinese quota messages and relay `insufficient_user_*` errors;
- Zen-aware update checks against `@oh-my-pi-zen/pi-coding-agent` instead of upstream npm packages.
