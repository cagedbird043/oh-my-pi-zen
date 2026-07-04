# Oh My Pi Zen Downstream Notes

Oh My Pi Zen is a downstream distribution of upstream Oh My Pi. It carries a small, explicit patch stack for dogfooding, provider ergonomics, and release tooling while keeping generally useful fixes available as upstream PRs.

## Branch taxonomy

- `zen/main`: integrated downstream branch. This is the branch used for dogfooding and Zen releases.
- `upstream-pr/*`: patches intended for upstream Oh My Pi. Keep these branches clean and reviewable; existing GitHub PR head branches may keep their historical names when GitHub cannot rename them in place.
- `topic/*`: Zen downstream patch-stack branches. Use these for Zen-only features, dogfood tooling, release infrastructure, or experiments not yet ready for upstream.
- `main`: upstream mirror compatibility branch. Do not use it as the Zen integration branch.

Current upstream PR branches:

- `upstream-pr/anysearch-provider`: AnySearch web search provider support. Existing upstream PR: `can1357/oh-my-pi#3723`; historical PR head: `feat/anysearch-provider`.
- `upstream-pr/gemini-thinking-loop-guard`: Gemini / Cloud Code Assist hidden-thinking-summary plumbing. Existing upstream PR: `can1357/oh-my-pi#4400`; historical PR head: `fix/gemini-loop-guard-prose-default`.

Current Zen topic branches:

- `topic/model-role-fallback-chain`: ordered `modelRoles.<role>` provider fallback chains, role-chain UI badges, status-line provider display, and provider quota-message compatibility.
- `topic/zen-dogfood-ops`: local dogfood installer and Zen-aware update checks.
- `topic/zen-release`: release packaging, notes, and distribution workflow.

## Patch-stack rules

- Prefer `upstream-pr/*` for general fixes that should benefit upstream users.
- Prefer `topic/*` for Zen-specific behavior, local dogfood workflows, provider gateway compatibility, and downstream release engineering.
- Keep topic branches rebased or recreated from a known base when they need to stay reviewable.
- Keep `zen/main` as the tested integration result, not as the only place where patch intent is documented.
- When upstream merges a PR, remove the duplicate downstream patch from `zen/main` during the next rebase/reconciliation.

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
- Zen versions follow the distro-style format `<upstreamVersion>-zen.N`, for example `16.3.6-zen.3`.
- Same upstream base increments `zen.N`; a new upstream base resets the counter, for example `16.3.7-zen.1`.
- Supported binary targets are `linux-x64`, `linux-arm64`, and `darwin-arm64`.
- Windows and macOS x64 are not Zen release targets.

## User-visible Zen patches

Current dogfood patch stack includes:

- ordered model role fallback chains: `modelRoles.default: a,b,c` means `a -> b -> c` at runtime;
- model selector chain badges such as `DEFAULT#0`, `DEFAULT#1`, and `TASK#0`;
- `statusLine.segmentOptions.model.showProvider` for status-line values like `codez/GPT-5.5`;
- quota/usage-limit detection for gateway errors including Chinese quota messages such as `额度不足`;
- Zen-aware update checks against `@oh-my-pi-zen/pi-coding-agent` instead of upstream npm packages.
