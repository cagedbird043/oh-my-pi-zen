# Credentials and Auth Cookbook

Task-oriented entry point for finding and operating `omp` credential flows. Search terms: CPA, CLIProxyAPI, sub2api, sub2api-data, import credentials, import API key, import OAuth, auth dump, broker, gateway, login, logout, migrate, 导入密钥, 导入账号, 导入凭据.

## Pick the right path

| Goal | Command |
| --- | --- |
| Login interactively inside an `omp` session | `/login` or `/login <provider>` |
| Remove stored credentials inside a session | `/logout` |
| Login on a headless broker host | `omp auth-broker login <provider>` |
| Login on a remote broker through SSH port forwarding | `omp auth-broker login <provider> --via=user@host` |
| Import a CLIProxyAPI / CPA auth dump | `omp auth-broker import ~/.cliproxy/auth --dry-run` then rerun without `--dry-run` |
| Import one CPA JSON with an explicit provider | `omp auth-broker import path/to/account.json --provider openai-codex` |
| Import a sub2api-data OpenAI/Codex account export | `omp auth-broker import path/to/sub2api-data.json --dry-run` then rerun without `--dry-run` |
| Migrate local stored keys to a configured broker | `omp auth-broker migrate --from-local --include-env --dry-run` then rerun without `--dry-run` |
| List broker-supported OAuth providers | `omp auth-broker list` or `omp auth-broker list --json` |
| Check broker reachability | `omp auth-broker status` |
| Check gateway credentials | `omp auth-gateway check` or `omp auth-gateway check --json` |

## In-session login

Use slash commands when you are already inside an interactive `omp` session:

```text
/login
/login anthropic
/login openai-codex
/logout
```

`/login` opens the provider selector. `/login <provider>` jumps to one provider. Some OAuth flows ask you to paste a callback URL/code back into the prompt.

## Auth broker login

Use the broker commands when credentials should live in the shared broker store rather than only in the current local session database:

```sh
omp auth-broker login anthropic
omp auth-broker login openai-codex
omp auth-broker login google-gemini-cli
```

For a remote broker host, run the login through the built-in SSH tunnel helper:

```sh
omp auth-broker login anthropic --via=user@broker-host
```

The OAuth callback reaches the browser on the local machine, but the credential is written on the broker host.

## Import CLIProxyAPI / CPA credentials

`omp auth-broker import` reads CLIProxyAPI-style JSON files. Preview first:

```sh
omp auth-broker import ~/.cliproxy/auth --dry-run
```

Apply after reviewing the preview:

```sh
omp auth-broker import ~/.cliproxy/auth
```

Import one file and override the provider mapping when the JSON `type` is missing or ambiguous:

```sh
omp auth-broker import ~/.cliproxy/auth/codex-plus.json --provider openai-codex
```

Default CPA type mapping:

| CPA `type` | omp provider |
| --- | --- |
| `claude` | `anthropic` |
| `codex` | `openai-codex` |
| `gemini` | `google-gemini-cli` |
| `gemini-cli` | `google-gemini-cli` |
| `antigravity` | `google-antigravity` |

Disabled CPA rows are skipped by default. Include them only when you want to preserve disabled credentials for inspection:

```sh
omp auth-broker import ~/.cliproxy/auth --include-disabled --dry-run
```

Use JSON output for scripts:

```sh
omp auth-broker import ~/.cliproxy/auth --dry-run --json
```

## Import sub2api-data OpenAI / Codex exports

`omp auth-broker import` also reads sub2api-data batch exports shaped as `{ "type": "sub2api-data", "version": 1, "accounts": [...] }`. Only `platform: "openai"` plus `type: "oauth"` accounts are imported, and they map to `openai-codex`.

Preview first:

```sh
omp auth-broker import ~/Downloads/sub2api-data.json --dry-run --json
```

Apply after reviewing the plan:

```sh
omp auth-broker import ~/Downloads/sub2api-data.json
```

Sub2api exports often contain access-token-only Codex accounts with an empty `refresh_token`. These are imported as usable temporary credentials:

```text
openai-codex: user@example.com [sub2api; team; access-token-only; expires 2026-10-06T03:01:13.000Z]
```

When an access-token-only credential expires, `omp` cannot refresh it through OpenAI; import a fresh sub2api export.

## Migrate local API keys to a broker

If credentials already exist in the local `omp` auth store or environment, migrate them to the configured broker:

```sh
omp auth-broker migrate --from-local --include-env --dry-run
omp auth-broker migrate --from-local --include-env
```

`--include-env` captures provider API keys from environment variables. OAuth rows in the local SQLite store are skipped unless `--include-oauth` is set:

```sh
omp auth-broker migrate --from-local --include-oauth --dry-run
```

Re-running migration is idempotent against the broker snapshot.

## Broker and gateway checks

Inspect broker-side credentials and health:

```sh
omp auth-broker list
omp auth-broker list --json
omp auth-broker status
```

Inspect the gateway token and credential health:

```sh
omp auth-gateway status
omp auth-gateway check
omp auth-gateway check --json
```

Use strict gateway checks only when you accept a small real provider request per credential:

```sh
omp auth-gateway check --strict
```

## Configuration knobs

Broker clients read these from `config.yml` or environment variables:

```yaml
auth:
  broker:
    url: http://127.0.0.1:8765
    token: <bearer-token>
```

Environment overrides:

```sh
OMP_AUTH_BROKER_URL=http://127.0.0.1:8765
OMP_AUTH_BROKER_TOKEN=<bearer-token>
```

The gateway creates its own bearer token with:

```sh
omp auth-gateway token
```

See also:

- [Providers](./providers.md) — provider availability, credential precedence, `/login`, environment variables, and custom `models.yml` providers.
- [Auth Broker and Auth Gateway](./auth-broker-gateway.md) — broker/gateway architecture, endpoints, and runtime behavior.
- [Environment variables](./environment-variables.md) — full provider credential environment variable reference.
- [Secret Obfuscation](./secrets.md) — preventing secrets from being sent to LLM providers in prompts/context.
