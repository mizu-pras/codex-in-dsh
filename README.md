# codex-in-dsh

Use an **OpenAI Codex subscription** (ChatGPT Plus / Pro) as a model provider in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — no OpenAI
API key and no API billing.

The repo contains one dependency-free Node script that runs the same ChatGPT device-code
OAuth flow pi-ai / Codex CLI uses, stores the credential as the DSH record
`llm-pi-ai/openai-codex`, and a tutorial (in Indonesian) covering the route declaration,
model catalog management, model ordering, the Fast / Ultrafast situation, and
troubleshooting.

| File | Purpose |
|---|---|
| [`codex-oauth-login.mjs`](codex-oauth-login.mjs) | OAuth login, credential record writer, token verify, model-list emit/probe |
| [`TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md`](TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md) | End-to-end tutorial (Indonesian) |
| [`README.md`](README.md) | This file |

## Requirements

- A ChatGPT subscription with Codex access (Plus or Pro). Ultrafast requires the Pro $500
  plan or eligible Enterprise/Edu; self-serve plans cannot use it.
- DSH installed and launched at least once (so `~/.dsh/.credentials.yaml` exists).
- Node.js ≥ 18 (DSH Desktop ships its own Node if you do not have one).
- A browser to approve the device code (`https://auth.openai.com/codex/device`). There is
  no local callback, so a headless machine works too: open the URL anywhere and type the
  code printed by the script.

## Quick start

```bash
# 0) Get the repo (public, no GitHub account needed)
git clone https://github.com/mizu-pras/codex-in-dsh.git
cd codex-in-dsh

# 1) Log in: prints a URL + code, waits for approval, writes the record, then verifies.
node codex-oauth-login.mjs

# 2) Declare the route in DSH:
#    Settings -> Models -> Add model provider -> Third-party -> openai-codex,
#    leave the API key EMPTY, Apply. (Restart DSH if the picker does not refresh.)
#    YAML alternative: add `openai-codex: {}` under `providers:` of the llm-pi-ai entry
#    in ~/.dsh/profiles/<profile>/cordis.patch.yml

# 3) Verify and inspect the model catalog
#    (--emit-models reads the Codex CLI model cache; run `codex` once if it is missing.)
node codex-oauth-login.mjs --verify
node codex-oauth-login.mjs --emit-models --probe
```

Then pick e.g. **GPT-6.1 Sol** in the DSH model picker.

## Setup with an AI agent

The fastest path: let the agent inside DSH (or any coding agent that can run shell commands
and edit files, e.g. Claude Code or Codex) do the whole setup for you. Open a new chat,
paste the prompt below, and only step in when it shows you the login URL and device code.

**Before you paste**

- Start the chat in a folder you are happy to clone into (for example your home folder or a
  workspace folder). The agent clones the repo there.
- The agent needs to write outside that folder (`~/.dsh/.credentials.yaml` and
  `~/.dsh/profiles/<profile>/cordis.patch.yml`). In DSH's `workspace-write` mode it will ask
  for approval; approve those two paths only.
- Device login has no local callback: the agent shows a URL and a code, you enter the code
  in the browser. Any browser or machine will do, as long as it can reach OpenAI.

**Prompt** (Indonesian, copy as-is):

```text
Pasang OpenAI Codex subscription (OAuth) di DSH ini memakai repo publik
https://github.com/mizu-pras/codex-in-dsh.git

1. Repo: kalau folder codex-in-dsh belum ada di working directory sesi ini, jalankan
   `git clone https://github.com/mizu-pras/codex-in-dsh.git`; kalau sudah ada, masuk ke
   folder itu dan jalankan `git pull`. Kalau `git` tidak tersedia, unduh
   https://github.com/mizu-pras/codex-in-dsh/archive/refs/heads/main.zip lalu ekstrak.
   Semua langkah berikut dijalankan dari folder repo itu.
2. Baca README.md dan TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md di folder itu sebelum
   mengubah apa pun.
3. Cek dulu: `node codex-oauth-login.mjs --print-path` untuk melihat lokasi store, status
   record, dan status route. Kalau record sudah valid, lewati langkah 4.
4. Login: jalankan `node codex-oauth-login.mjs` sebagai background job, lalu tampilkan URL
   https://auth.openai.com/codex/device beserta kode device-nya ke saya sebagai teks
   (jangan dimatikan job-nya). Tunggu job selesai, lalu laporkan hasil verifikasinya.
5. Route: kalau provider `openai-codex` belum dideklarasikan, tambahkan di profil DSH yang
   sedang dipakai (~/.dsh/profiles/<profil>/cordis.patch.yml, di bawah `providers:` entry
   llm-pi-ai). Backup file dulu. Jalankan `node codex-oauth-login.mjs --emit-models` dan
   pakai urutan model yang dicetak (urutan prioritas Codex). Kalau perintah itu gagal
   karena cache Codex CLI belum ada, pakai daftar model di tutorial bagian 6d. Validasi
   YAML setelah edit.
6. Uji: jalankan `node codex-oauth-login.mjs --verify` dan
   `node codex-oauth-login.mjs --emit-models --probe`, lalu laporkan model yang gagal.
7. Tutup dengan ringkasan: lokasi repo, model yang aktif, lokasi record kredensial, file
   yang diubah beserta backup-nya, dan langkah di UI (muat ulang atau restart DSH, lalu
   pilih model Codex).

Aturan: jangan mencetak token atau isi kredensial. Jangan mengubah konfigurasi di luar yang
diminta. Kalau `node` tidak ada, pakai Node bawaan DSH Desktop. Kalau browser tidak bisa
dibuka otomatis, cukup tampilkan URL dan kode device-nya ke saya.
```

**Follow-up prompts**

```text
Cek ulang setup OpenAI Codex subscription dari repo codex-in-dsh: jalankan
`node codex-oauth-login.mjs --verify` dan `node codex-oauth-login.mjs --emit-models --probe`,
laporkan model yang gagal tanpa mencetak token.
```

```text
Token Codex subscription saya error. Di repo codex-in-dsh, jalankan
`node codex-oauth-login.mjs --verify`; kalau gagal atau `INVALID_CREDENTIAL`, login ulang
dengan `node codex-oauth-login.mjs` sebagai background job dan tampilkan URL + kode
device-nya ke saya.
```

## Commands

```bash
node codex-oauth-login.mjs                        # device login, store, verify
node codex-oauth-login.mjs --dry-run              # login, show the write plan, write nothing
node codex-oauth-login.mjs --from-codex-cli       # import an existing `codex login`
node codex-oauth-login.mjs --verify               # check stored record (+ refresh) and send one test request
node codex-oauth-login.mjs --print-path           # store location, record status, route status
node codex-oauth-login.mjs --emit-models          # ready-to-paste `models:` block in Codex priority order
node codex-oauth-login.mjs --emit-models --probe  # same, but only models this account can use
node codex-oauth-login.mjs --start-only           # print the device code only, stop (debug/manual flow)
node codex-oauth-login.mjs --help
```

Options: `--dry-run`, `--no-browser`, `--no-verify`, `--all` (with `--emit-models`: include
hidden / non-API models), `--dsh-home <dir>`, `--codex-cache <file>`,
`--service-tier <priority|fast|ultrafast|flex|default>`.

## How it works

- The script runs OpenAI's public device-code OAuth flow with the Codex CLI client id (the
  same flow `@earendil-works/pi-ai` implements for `OpenAI Codex (legacy)`), reads the
  `chatgpt_account_id` from the access-token JWT, and exchanges the device code for an
  access + refresh token at `auth.openai.com`.
- The resulting credential is written to `~/.dsh/.credentials.yaml` as one record:

  ```yaml
  records:
    llm-pi-ai/openai-codex:
      kind: grant
      payload:
        type: oauth
        access: '...'
        refresh: '...'
        expires: 1794...
        accountId: '...'
  ```

  Backups are taken before every write, writes are atomic, and the file stays `0600`.
- DSH's `dsh-llm-pi-ai` resolves that record per request, and pi-ai's `openai-codex`
  provider posts to `https://chatgpt.com/backend-api/codex/responses` with
  `Authorization: Bearer` plus the `chatgpt-account-id` header. Access tokens last about
  10 days; pi-ai refreshes 5 minutes before expiry, rotates the refresh token, and writes
  the record back. No manual refresh step.
- The token is never printed to stdout or sent anywhere except `auth.openai.com`
  (device login / exchange / refresh) and `chatgpt.com` (verification, probe, and model
  requests).
- `--from-codex-cli` imports the token from `~/.codex/auth.json` instead. DSH and Codex
  CLI then share one single-use refresh token, so one side refreshing can break the other;
  for long-term use the device login is safer because DSH gets its own token.

## Model order

Model order in the DSH picker follows the `models:` array order of the route — see
tutorial section 6c. Without a `models:` list the full pi-ai catalog is inherited (9 chat
models as of DSH 0.2.2-rc.1, including some that are no longer usable on ChatGPT accounts,
such as `gpt-5.5` and `gpt-5.3-codex-spark`).

The bundled pi-ai catalog is a snapshot taken at DSH release time, so models released later
(for example `gpt-6.1-terra`) are not picked up automatically. `--emit-models` reads the
Codex CLI catalog cache (`~/.codex/models_cache.json`) and prints a ready-to-paste `models:`
block in Codex priority order; `--emit-models --probe` sends one tiny request per model so
only models your account can actually use are emitted. A `models:` list **replaces** the
route's catalog wholesale, so paste it over the whole list instead of adding lines inside it.

Tested with DSH `0.2.1-rc.5` and `0.2.2-rc.1` on macOS, pi-ai 1.1.0 / 1.3.0, and
Codex CLI 0.166.0; model availability checked 5 Nov 2026.

## Fast and Ultrafast

OpenAI has two speed tiers, and both are service tiers rather than separate models:

- **Fast** — `service_tier: "priority"` on the Codex endpoint, roughly 2× faster, at a
  higher subscription usage rate.
- **Ultrafast** — the fastest tier, GPT-6 Astra and GPT-6.1 Sol only; Pro $500 and eligible
  Enterprise/Edu plans.

DSH 0.2.x cannot select either tier: pi-ai supports `options.serviceTier` → request body
`service_tier`, but `dsh-llm-pi-ai` never forwards it and its Config has no `serviceTier`
field. Declaring a fake `gpt-6.1-sol-fast` model entry does not work either — the picker id
is sent verbatim as the request model, and the Codex endpoint rejects unknown ids with
HTTP 400. Use Codex CLI (`/fast`) or the ChatGPT app for these modes today; the direct
endpoint probes are documented in tutorial section 7.

## Security and policy

- The credential record is **full access to your ChatGPT account** on the Codex path. Never
  share or commit `~/.dsh/.credentials.yaml`, and do not paste its contents into chat.
- The file is written `0600`; backup files (`.bak.*`) also contain tokens, so delete old
  backups when you no longer need them.
- The script only talks to `auth.openai.com` and `chatgpt.com`. No telemetry, no token sent
  anywhere else.
- If a token leaks, revoke the session in your ChatGPT account settings and log in again
  (`--verify` keeps failing with `INVALID_CREDENTIAL` until you do).
- Do not use a shared or team account without the admin's permission; Codex access follows
  the account's plan.
- OpenAI does not document this subscription OAuth flow as a supported path for third-party
  clients; it is the flow Codex CLI and the native ChatGPT apps use. Using your own
  subscription token in another client is a grey area, and OpenAI may enforce its terms.
  Your account, your risk.
- For a clearly supported alternative, run the real Codex CLI as a DSH subagent with its
  native login instead — enable **Codex subagent** on the DSH Plugins page
  (`@deepseek-ai/dsh-subagent-codex`).

## License

MIT — see [LICENSE](LICENSE).
