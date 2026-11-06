# codex-in-dsh

Use an **OpenAI Codex subscription** (ChatGPT Plus/Pro) as a model provider in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — no OpenAI
API key and no API billing.

The repo contains one dependency-free Node script that runs the same ChatGPT device-code
OAuth flow pi-ai / Codex CLI uses, stores the credential as the DSH record
`llm-pi-ai/openai-codex`, and a tutorial (Indonesian) covering route declaration, model
catalog management, model ordering, the Fast/Ultrafast situation, and troubleshooting.

| File | Purpose |
|---|---|
| [`codex-oauth-login.mjs`](codex-oauth-login.mjs) | OAuth login, credential-record writer, token verify, model-list emit/probe |
| [`TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md`](TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md) | End-to-end tutorial (Indonesian) |
| [`README.md`](README.md) | This file |

## Requirements

- A ChatGPT subscription with Codex access (Plus or Pro). Ultrafast requires the Pro $500
  plan or eligible Enterprise/Edu; self-serve plans cannot use it.
- DSH installed and launched at least once, so `~/.dsh/.credentials.yaml` exists.
- Node.js ≥ 18 (DSH Desktop ships its own Node under
  `Contents/Resources/runtime/primary-runtime/dependencies/node/`).
- A browser to approve the device code.

## Quick start

```bash
# 1) Log in: prints a URL + code, waits for approval, writes the credential record,
#    then sends one verification request.
node codex-oauth-login.mjs

# 2) Declare the route in DSH:
#    Settings -> Models -> Add model provider -> Third-party model provider ->
#    openai-codex, leave the API key EMPTY, Apply. Restart DSH if the picker does not
#    refresh.
#
#    YAML alternative — under the llm-pi-ai entry of
#    ~/.dsh/profiles/<profile>/cordis.patch.yml:
#
#      providers:
#        openai-codex: {}

# 3) Verify and inspect the model catalog
node codex-oauth-login.mjs --verify
node codex-oauth-login.mjs --emit-models --probe
```

## Model catalog

DSH uses the pi-ai catalog bundled at release time, and a profile's `models:` list
**replaces** that catalog. Models released after the bundle (for example
`gpt-6.1-terra`) therefore need to be listed by hand.

`--emit-models` reads the Codex CLI catalog cache (`~/.codex/models_cache.json`) and prints
a ready-to-paste `models:` block in Codex priority order; `--probe` adds one tiny request per
model so only models your account can actually use are emitted. The model picker shows models
in the order they appear in `models:`.

## Fast and Ultrafast

OpenAI has two speed tiers:

- **Fast** — `service_tier: "priority"` / `"fast"`, up to ~2.5× faster, subscription usage
  at 2.5× the standard rate.
- **Ultrafast** — the fastest tier, GPT-6 Astra and GPT-6.1 Sol only; Pro $500 and eligible
  Enterprise/Edu plans.

DSH 0.2.x does not expose a service-tier setting: pi-ai supports it
(`options.serviceTier` → request body `service_tier`), but `dsh-llm-pi-ai` never forwards
it. Use Codex CLI / the ChatGPT app for those modes today. Direct probes against the
subscription Codex endpoint are documented in the tutorial (section 7), including the
observed outcome that `priority`/`ultrafast` requests were served as `default` on a
`prolite` plan and that `fast`/`flex` are rejected by that endpoint.

## Security

- The credential record is written to `~/.dsh/.credentials.yaml` (mode 0600) with an
  automatic `.bak.<timestamp>` backup. Backups contain tokens — delete old ones.
- Never commit or share the credential file. The script prints only redacted token hints.
- Access/refresh tokens are rotated automatically; re-run the script to sign in again.

## Tested

DSH `0.2.1-rc.5` and `0.2.2-rc.1` on macOS, pi-ai 1.1.0 / 1.3.0, Codex CLI 0.166.0.
Model availability checked 5 Nov 2026.

## License

MIT — see [LICENSE](LICENSE).
