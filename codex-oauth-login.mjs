#!/usr/bin/env node
/**
 * codex-oauth-login.mjs
 *
 * Menyiapkan kredensial OAuth "OpenAI Codex (legacy)" — provider `openai-codex`
 * di DeepSeek Harness (DSH) — memakai langganan ChatGPT (Plus/Pro), bukan API key.
 *
 * Yang dilakukan:
 *   1. Menjalankan device-code login OpenAI (alur yang sama dengan Codex CLI / pi-ai).
 *   2. Menukar authorization code menjadi access + refresh token.
 *   3. Menyimpan/menimpa satu record `llm-pi-ai/openai-codex` di
 *      `$DSH_HOME/.credentials.yaml` (default ~/.dsh/.credentials.yaml), dengan
 *      backup, penulisan atomik, dan mode 0600. Token tidak pernah dicetak.
 *   4. Opsional: memverifikasi token dengan satu request kecil ke model codex.
 *
 * Tanpa dependensi (Node >= 18, butuh fetch bawaan). Tidak membaca atau menulis
 * file lain, tidak mengubah cordis.patch.yml.
 *
 * Pemakaian:
 *   node codex-oauth-login.mjs                 # login browser/device code, simpan, verifikasi
 *   node codex-oauth-login.mjs --dry-run      # login + tampilkan rencana, TIDAK menulis
 *   node codex-oauth-login.mjs --verify       # tidak login: cek record tersimpan + request uji
 *   node codex-oauth-login.mjs --from-codex-cli  # impor token dari ~/.codex/auth.json
 *   node codex-oauth-login.mjs --print-path   # tampilkan lokasi store & record
 *   node codex-oauth-login.mjs --emit-models  # cetak blok YAML model terbaru (dari cache Codex CLI)
 *   node codex-oauth-login.mjs --emit-models --probe  # sekalian uji tiap model, hanya cetak yang bisa dipakai
 *   node codex-oauth-login.mjs --verify --service-tier priority  # uji Fast/Ultrafast (lihat tutorial bagian 7)
 *
 * Flag lain:
 *   --all              dengan --emit-models: ikutkan model hidden / non-API
 *   --codex-cache <f>  path models_cache.json Codex CLI
 *   --dsh-home <dir>   override DSH_HOME (default: env DSH_HOME atau ~/.dsh)
 *   --no-browser       jangan coba membuka browser otomatis
 *   --no-verify        lewati request verifikasi setelah menyimpan
 *   --help
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'; // client id OAuth Codex CLI / pi-ai
const AUTH_BASE = 'https://auth.openai.com';
const DEVICE_VERIFY_URI = 'https://auth.openai.com/codex/device';
const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const RECORD_KEY = 'llm-pi-ai/openai-codex';
const RECORD_SCOPE_DIR = 'llm-pi-ai';
const DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TEST_MODEL = process.env.CODEX_TEST_MODEL || 'gpt-6.1-sol';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const HELP = has('--help') || has('-h');
const DRY_RUN = has('--dry-run');
const VERIFY_ONLY = has('--verify');
const FROM_CODEX_CLI = has('--from-codex-cli');
const NO_BROWSER = has('--no-browser');
const NO_VERIFY = has('--no-verify');
const PRINT_PATH = has('--print-path');
const START_ONLY = has('--start-only');
const EMIT_MODELS = has('--emit-models');
const EMIT_ALL = has('--all');
const PROBE = has('--probe');
const DSH_HOME = opt('--dsh-home') ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml');
const RAW_SERVICE_TIER = opt('--service-tier') ?? process.env.CODEX_SERVICE_TIER;
const SERVICE_TIER = RAW_SERVICE_TIER && RAW_SERVICE_TIER.trim().length > 0 ? RAW_SERVICE_TIER.trim() : undefined;
const EXTRA_HEADERS = (() => {
  const raw = process.env.CODEX_EXTRA_HEADERS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
})();

const log = (msg = '') => console.log(msg);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** Nilai rahasia hanya ditampilkan dalam bentuk potongan, tidak pernah utuh. */
function redact(value) {
  if (typeof value !== 'string' || value.length === 0) return '<kosong>';
  if (value.length <= 12) return '<disembunyikan>';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} karakter)`;
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token akses bukan JWT yang valid');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function accountIdOf(accessToken) {
  const claim = decodeJwt(accessToken)[JWT_CLAIM_PATH];
  const id = claim?.chatgpt_account_id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Token tidak memuat chatgpt_account_id (akun tanpa akses Codex?)');
  }
  return id;
}

async function postJson(url, body, { headers = {}, timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: response.status, ok: response.ok, json };
}

async function postForm(url, params, { timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: response.status, ok: response.ok, json };
}

function openInBrowser(url) {
  if (NO_BROWSER) return;
  try {
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* URL tetap dicetak untuk dibuka manual */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deviceLogin() {
  const start = await postJson(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, { client_id: CLIENT_ID });
  if (!start.ok) fail(`Gagal memulai device login (HTTP ${start.status}): ${JSON.stringify(start.json).slice(0, 300)}`);

  const { device_auth_id: deviceAuthId, user_code: userCode, interval } = start.json;
  const intervalSeconds = Number(interval) > 0 ? Number(interval) : 5;

  log('');
  log('  Buka tautan ini di browser:');
  log(`    ${DEVICE_VERIFY_URI}`);
  log('  Lalu login dengan akun ChatGPT Plus/Pro dan masukkan kode:');
  log('');
  log(`    ${userCode}`);
  log('');
  log('  Kode berlaku ±15 menit. Menunggu persetujuan…');
  openInBrowser(DEVICE_VERIFY_URI);

  const deadline = Date.now() + DEVICE_CODE_TIMEOUT_MS;
  for (;;) {
    await sleep((intervalSeconds + 1) * 1000);
    if (Date.now() > deadline) fail('Device login kedaluwarsa. Jalankan skrip lagi untuk kode baru.');

    const poll = await postJson(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
      device_auth_id: deviceAuthId,
      user_code: userCode,
    });

    if (poll.ok) {
      const { authorization_code: authorizationCode, code_verifier: codeVerifier } = poll.json;
      if (!authorizationCode || !codeVerifier) fail('Respons device login tidak lengkap.');
      const exch = await postForm(`${AUTH_BASE}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: DEVICE_REDIRECT_URI,
      });
      if (!exch.ok) fail(`Tukar authorization code gagal (HTTP ${exch.status}): ${JSON.stringify(exch.json).slice(0, 300)}`);
      log('  ✓ Login disetujui, token diterima.');
      return tokenToCredential(exch.json);
    }

    const code = poll.json?.error?.code ?? poll.json?.error;
    if (poll.status === 403 || poll.status === 404 || code === 'deviceauth_authorization_pending') continue;
    if (code === 'slow_down') {
      await sleep(5000);
      continue;
    }
    fail(`Device login gagal (HTTP ${poll.status}): ${JSON.stringify(poll.json).slice(0, 300)}`);
  }
}

function tokenToCredential(token) {
  const access = token.access_token;
  const refresh = token.refresh_token;
  const expiresIn = Number(token.expires_in);
  if (typeof access !== 'string' || typeof refresh !== 'string' || !Number.isFinite(expiresIn)) {
    fail('Respons token tidak memuat access_token / refresh_token / expires_in.');
  }
  return {
    type: 'oauth',
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000,
    accountId: accountIdOf(access),
  };
}

function credentialFromCodexCli() {
  const file = path.join(os.homedir(), '.codex', 'auth.json');
  if (!fs.existsSync(file)) fail(`Tidak ada ${file}. Login dulu dengan Codex CLI ("codex login").`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tokens = data.tokens ?? {};
  const access = tokens.access_token ?? tokens.access;
  const refresh = tokens.refresh_token ?? tokens.refresh;
  if (typeof access !== 'string' || typeof refresh !== 'string') {
    fail('auth.json Codex CLI tidak memuat access/refresh token (mode ChatGPT?).');
  }
  const expires = Number(decodeJwt(access).exp) * 1000;
  return { type: 'oauth', access, refresh, expires, accountId: accountIdOf(access) };
}

/* ------------------------------------------------------------------ */
/*  Store kredensial (YAML sederhana milik dsh-credentials-local)      */
/* ------------------------------------------------------------------ */

function yamlScalar(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function payloadLines(credential) {
  return [
    '      type: oauth',
    `      access: ${yamlScalar(credential.access)}`,
    `      refresh: ${yamlScalar(credential.refresh)}`,
    `      expires: ${Math.trunc(credential.expires)}`,
    `      accountId: ${credential.accountId}`,
  ];
}

function recordBlock(credential) {
  return ['  llm-pi-ai/openai-codex:', '    kind: grant', '    payload:', ...payloadLines(credential)];
}

/** Cari bagian record bernama RECORD_KEY; kembalikan {start,end} indeks baris. */
function locateRecord(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `  ${RECORD_KEY}:`) {
      let end = i + 1;
      while (end < lines.length) {
        const line = lines[end];
        if (/^ {0,1}[^ ]/.test(line) || /^ {2}[^ ]/.test(line)) break;
        end++;
      }
      return { start: i, end };
    }
  }
  return null;
}

function locateRecordsSection(lines) {
  const start = lines.findIndex((line) => /^records:\s*$/.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z#]/.test(lines[end])) end++;
  return { start, end };
}

/** Sisipkan/ganti record. Mengembalikan teks baru; melempar bila struktur tak dikenal. */
function upsertRecord(text, credential) {
  const lines = text.split('\n');
  const section = locateRecordsSection(lines);
  const block = recordBlock(credential);

  if (section === null) {
    // File tanpa bagian records: sisipkan sebelum "refs:" atau di akhir.
    const anchor = lines.findIndex((line) => /^refs:\s*$/.test(line));
    const insertAt = anchor >= 0 ? anchor : lines.length;
    const payload = ['records:', ...block, ''];
    lines.splice(insertAt, 0, ...payload);
    return withFinalNewline(lines.join('\n'));
  }

  const existing = locateRecord(lines);
  if (existing !== null) {
    const replaced = lines.slice(existing.start, existing.end);
    if (replaced.some((line) => /^\s+kind:/.test(line)) && !replaced.some((line) => /^\s+kind: grant/.test(line))) {
      // Record dengan kind lain: tetap ditimpa, tetapi beri tahu pemanggil.
      log(`  ! Record lama berjenis lain ditemukan dan akan diganti (${replaced.length} baris).`);
    }
    lines.splice(existing.start, existing.end - existing.start, ...block);
    return withFinalNewline(lines.join('\n'));
  }

  // Belum ada: sisipkan di akhir bagian records, dengan baris kosong pemisah bila perlu.
  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1] === '') insertAt--;
  lines.splice(insertAt, 0, '', ...block);
  return withFinalNewline(lines.join('\n'));
}

function withFinalNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function parseStoredCredential(text) {
  const lines = text.split('\n');
  const found = locateRecord(lines);
  if (!found) return null;
  let credential = { type: 'oauth' };
  let inPayload = false;
  for (let i = found.start + 1; i < found.end; i++) {
    const line = lines[i];
    if (/^    payload:\s*$/.test(line)) {
      inPayload = true;
      continue;
    }
    if (!inPayload) continue;
    const match = /^ {6}([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    let value = raw.trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key === 'expires') credential.expires = Number(value);
    else if (key === 'type' || key === 'access' || key === 'refresh' || key === 'accountId') credential[key] = value;
  }
  if (!credential.access || !credential.refresh) return null;
  credential.accountId = credential.accountId ?? accountIdOf(credential.access);
  return credential;
}

function validateEdit(before, after, credential, { expectNewRecord }) {
  const beforeKeys = (before.match(/^ {2}[A-Za-z0-9/_.-]+:/gm) ?? []).map((line) => line.trim().replace(/:$/, ''));
  const afterKeys = (after.match(/^ {2}[A-Za-z0-9/_.-]+:/gm) ?? []).map((line) => line.trim().replace(/:$/, ''));
  const uniqueAfter = new Set(afterKeys);
  if (uniqueAfter.size !== afterKeys.length) throw new Error('Validasi gagal: ada key record duplikat setelah edit.');
  if (!uniqueAfter.has(RECORD_KEY)) throw new Error('Validasi gagal: record baru tidak ditemukan.');
  for (const key of beforeKeys) {
    if (key === RECORD_KEY) continue;
    if (!uniqueAfter.has(key)) throw new Error(`Validasi gagal: record lama hilang (${key}).`);
  }
  if (expectNewRecord && beforeKeys.includes(RECORD_KEY)) throw new Error('Validasi gagal: record sudah ada sebelumnya.');
  const parsed = parseStoredCredential(after);
  if (!parsed || parsed.refresh !== credential.refresh || parsed.access !== credential.access) {
    throw new Error('Validasi gagal: record tidak terbaca kembali dengan token yang sama.');
  }
  if (/\nrefs:/.test(before) && !/\nrefs:/.test(after)) throw new Error('Validasi gagal: bagian refs hilang.');
}

function writeCredentials(text, before) {
  const dir = path.dirname(CREDENTIALS_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${CREDENTIALS_FILE}.bak.${stamp}`;
  fs.copyFileSync(CREDENTIALS_FILE, backup);
  try {
    fs.chmodSync(backup, 0o600);
  } catch {
    /* Windows: mode tidak berlaku */
  }

  const temp = path.join(dir, `.credentials.yaml.tmp-${process.pid}`);
  fs.writeFileSync(temp, text, { mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    /* Windows */
  }
  const fd = fs.openSync(temp, 'r+');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(temp, CREDENTIALS_FILE);
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    /* Windows */
  }
  return backup;
}

function describeRouteDeclaration() {
  const profilesDir = path.join(DSH_HOME, 'profiles');
  if (!fs.existsSync(profilesDir)) return { declaredIn: [], checked: false };
  const declaredIn = [];
  for (const profile of fs.readdirSync(profilesDir)) {
    const patch = path.join(profilesDir, profile, 'cordis.patch.yml');
    if (!fs.existsSync(patch)) continue;
    if (fs.readFileSync(patch, 'utf8').includes(`${RECORD_SCOPE_DIR}`) && fs.readFileSync(patch, 'utf8').includes('openai-codex')) {
      declaredIn.push(profile);
    }
  }
  return { declaredIn, checked: true };
}


/* ------------------------------------------------------------------ */
/*  Model catalog dari cache Codex CLI (~/.codex/models_cache.json)    */
/* ------------------------------------------------------------------ */

function codexCachePath() {
  return opt('--codex-cache') ?? path.join(os.homedir(), '.codex', 'models_cache.json');
}

/**
 * Cetak blok YAML `models:` siap tempel ke profil DSH. Sumbernya cache katalog
 * Codex CLI (diperbarui saat Codex CLI dijalankan), bukan katalog pi-ai yang
 * dibundel DSH — jadi model baru ikut terlihat walau paket pi-ai belum
 * mengenalnya.
 */
async function emitModels() {
  const file = codexCachePath();
  if (!fs.existsSync(file)) {
    fail(
      `Tidak ada ${file}.\n` +
        'Jalankan Codex CLI sekali (mis. `codex` atau `codex login`) agar cache katalognya dibuat, ' +
        'atau berikan path lain dengan --codex-cache <file>.',
    );
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = Array.isArray(data.models) ? data.models : [];
  const models = all
    .filter((m) => EMIT_ALL || (m.supported_in_api === true && m.visibility === 'list'))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || String(a.slug).localeCompare(String(b.slug)));

  log(`# Sumber: ${file}`);
  log(`# Cache dibuat: ${data.fetched_at ?? 'tidak diketahui'} (client ${data.client_version ?? '?'})`);
  let selected = models;
  let excluded = [];
  if (PROBE) {
    if (!fs.existsSync(CREDENTIALS_FILE)) fail(`--probe butuh kredensial; tidak ada ${CREDENTIALS_FILE}.`);
    const credential = parseStoredCredential(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (!credential) fail(`--probe butuh record ${RECORD_KEY}; jalankan login dulu.`);
    log(`# Menguji ${models.length} model dengan akun ${credential.accountId}…`);
    const probed = await probeModels(credential, models);
    selected = probed.working;
    excluded = probed.excluded;
    log('#');
  }
  log(`# Model: ${selected.length}${EMIT_ALL ? ' (termasuk hidden/non-API)' : ' (API + terlihat di picker)'}`);
  log('#');
  log('# Tempel menggantikan daftar `models:` milik provider openai-codex.');
  log('# Catatan: contextWindow 272000 = tier harga dasar; katalog Codex menyebut');
  log('# nilai lebih besar untuk sebagian model (lihat komentar per entri).');
  log('');
  if (excluded.length > 0) {
    log('# Dikecualikan (tidak bisa dipakai akun ini):');
    for (const item of excluded) log(`#   ${item.slug} — ${String(item.error).slice(0, 140)}`);
    log('#');
  }
  log('        models:');
  for (const m of selected) {
    if (m.visibility !== 'list' || m.supported_in_api !== true) {
      log(`          # ${m.slug}: visibility=${m.visibility ?? '?'} supported_in_api=${m.supported_in_api}`);
    }
    const input = Array.isArray(m.input_modalities) && m.input_modalities.length > 0 ? m.input_modalities : ['text', 'image'];
    log(`          - id: ${m.slug}`);
    log(`            name: ${m.display_name ?? m.slug}`);
    log(`            contextWindow: 272000`);
    log(`            maxTokens: 128000`);
    log(`            input: [${input.join(', ')}]`);
    log('            reasoningEfforts:');
    log("              'off': null");
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) log(`              ${level}: ${level}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Verifikasi                                                         */
/* ------------------------------------------------------------------ */

async function refreshCredential(credential) {
  const response = await postForm(`${AUTH_BASE}/oauth/token`, {
    grant_type: 'refresh_token',
    refresh_token: credential.refresh,
    client_id: CLIENT_ID,
  });
  if (!response.ok) fail(`Refresh token ditolak (HTTP ${response.status}). Login ulang diperlukan.`);
  return tokenToCredential(response.json);
}

/**
 * Satu request kecil ke model codex. Mengembalikan hasil (tidak melempar) agar
 * bisa dipakai untuk verifikasi maupun probe daftar model.
 */
async function requestCodex(credential, model, serviceTier = SERVICE_TIER) {
  const sessionId = randomUUID();
  const body = {
    model,
    store: false,
    stream: true,
    instructions: 'You are a helpful assistant.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with exactly: ok' }],
      },
    ],
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: sessionId,
    tool_choice: 'auto',
    parallel_tool_calls: true,
  };
  if (serviceTier !== undefined) body.service_tier = serviceTier;

  let response;
  try {
    response = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.access}`,
        'chatgpt-account-id': credential.accountId,
        originator: 'pi',
        'openai-beta': 'responses=experimental',
        accept: 'text/event-stream',
        'content-type': 'application/json',
        'session-id': sessionId,
        'x-client-request-id': sessionId,
        'user-agent': 'pi (dsh codex-oauth-login)',
        ...EXTRA_HEADERS,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message ?? parsed?.detail ?? message;
    } catch {
      /* biarkan teks mentah */
    }
    return { ok: false, status: response.status, error: message };
  }

  let text = '';
  let reportedModel = '';
  let servedTier = '';
  let completed = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        let event;
        try {
          event = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }
        if (event.type === 'response.created') {
          reportedModel = event.response?.model ?? '';
          servedTier = event.response?.service_tier ?? '';
        }
        if (event.type === 'response.output_text.delta') text += event.delta ?? '';
        if (event.type === 'response.completed') {
          completed = true;
          servedTier = event.response?.service_tier ?? servedTier;
        }
        if (event.type === 'response.failed') {
          return {
            ok: false,
            status: 200,
            error: JSON.stringify(event.response?.error ?? event).slice(0, 300),
          };
        }
      }
      if (completed) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  if (!completed) return { ok: false, status: 200, error: 'stream berakhir tanpa response.completed' };
  return { ok: true, model: reportedModel || model, text: text.trim(), servedTier };
}

async function verifyLive(credential) {
  const result = await requestCodex(credential, TEST_MODEL);
  if (!result.ok) fail(`Request uji ke "${TEST_MODEL}" ditolak (HTTP ${result.status}): ${result.error}`);
  const tier = result.servedTier
    ? `, service_tier: ${result.servedTier}${SERVICE_TIER ? ` (diminta: ${SERVICE_TIER})` : ''}`
    : SERVICE_TIER
      ? `, diminta: ${SERVICE_TIER}`
      : '';
  log(`  ✓ Request uji berhasil — model: ${result.model}, jawaban: ${JSON.stringify(result.text.slice(0, 40))}${tier}`);
}

async function probeModels(credential, models) {
  const working = [];
  const excluded = [];
  for (const model of models) {
    const result = await requestCodex(credential, model.slug);
    if (result.ok) {
      working.push(model);
      log(`  ✓ ${model.slug}`);
    } else {
      excluded.push({ slug: model.slug, error: result.error });
      log(`  ✗ ${model.slug} — ${String(result.error).slice(0, 120)}`);
    }
  }
  return { working, excluded };
}

/* ------------------------------------------------------------------ */
/*  Alur utama                                                         */
/* ------------------------------------------------------------------ */

function printHelp() {
  log(`codex-oauth-login.mjs — kredensial OAuth ChatGPT untuk provider "openai-codex" di DSH

Pemakaian:
  node codex-oauth-login.mjs                    login device-code, simpan, verifikasi
  node codex-oauth-login.mjs --dry-run          login, tampilkan rencana (tidak menulis)
  node codex-oauth-login.mjs --verify           cek record tersimpan + request uji
  node codex-oauth-login.mjs --from-codex-cli   impor token dari ~/.codex/auth.json
  node codex-oauth-login.mjs --print-path       tampilkan lokasi store & record
  node codex-oauth-login.mjs --start-only       hanya cetak kode device (debug/lampiran)
  node codex-oauth-login.mjs --emit-models      cetak blok YAML model dari cache Codex CLI
  node codex-oauth-login.mjs --emit-models --probe  cetak hanya model yang lolos uji akun Anda

Opsi:
  --dsh-home <dir>   override DSH_HOME (default: $DSH_HOME atau ~/.dsh)
  --no-browser       jangan buka browser otomatis
  --no-verify        lewati request verifikasi
  --all              dengan --emit-models: ikutkan model hidden/non-API
  --probe            dengan --emit-models: uji tiap model (1 request masing-masing)
  --service-tier <t>  service tier untuk request uji (priority/fast/ultrafast/flex/default)
  --codex-cache <f>  path models_cache.json Codex CLI (default ~/.codex/models_cache.json)
  --help

Store: <DSH_HOME>/.credentials.yaml, record "${RECORD_KEY}".
Tidak ada token yang dicetak; file ditulis mode 0600 dengan backup.
`);
}

async function main() {
  if (HELP) return printHelp();

  if (EMIT_MODELS) {
    await emitModels();
    return;
  }

  if (START_ONLY) {
    const start = await postJson(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, { client_id: CLIENT_ID });
    if (!start.ok) fail(`Gagal memulai device login (HTTP ${start.status}): ${JSON.stringify(start.json).slice(0, 300)}`);
    log(`URL : ${DEVICE_VERIFY_URI}`);
    log(`Kode: ${start.json.user_code} (berlaku ±15 menit)`);
    log('Mode --start-only: skrip berhenti di sini; selesaikan sisa alur secara manual (lihat lampiran tutorial).');
    return;
  }

  if (PRINT_PATH) {
    log(`DSH_HOME        : ${DSH_HOME}`);
    log(`Credential store: ${CREDENTIALS_FILE} (${fs.existsSync(CREDENTIALS_FILE) ? 'ada' : 'BELUM ADA'})`);
    log(`Record          : ${RECORD_KEY}`);
    const route = describeRouteDeclaration();
    log(
      route.checked
        ? `Route declared  : ${route.declaredIn.length > 0 ? route.declaredIn.join(', ') : 'belum dideklarasikan di profil mana pun'}`
        : 'Route declared  : (folder profiles tidak ditemukan)',
    );
    return;
  }

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fail(
      `Tidak menemukan ${CREDENTIALS_FILE}.\n` +
        'Jalankan DeepSeek Harness sekali dulu (aplikasi Desktop atau `dsh web`) agar credential store dibuat, lalu ulangi.',
    );
  }
  const original = fs.readFileSync(CREDENTIALS_FILE, 'utf8');

  if (VERIFY_ONLY) {
    const stored = parseStoredCredential(original);
    if (!stored) fail(`Belum ada record ${RECORD_KEY}. Jalankan skrip tanpa --verify untuk login.`);
    let credential = stored;
    if (Number.isFinite(credential.expires) && credential.expires - REFRESH_MARGIN_MS < Date.now()) {
      log('  Token mendekati/melewati kedaluwarsa — mencoba refresh…');
      credential = await refreshCredential(credential);
      if (DRY_RUN) {
        log('  (dry-run) record hasil refresh tidak ditulis.');
      } else {
        const next = upsertRecord(original, credential);
        validateEdit(original, next, credential, { expectNewRecord: false });
        const backup = writeCredentials(next, original);
        log(`  ✓ Record diperbarui (backup: ${path.basename(backup)})`);
      }
    } else {
      log(`  Record ditemukan; token berlaku sampai ${new Date(credential.expires).toISOString()}.`);
    }
    if (!NO_VERIFY) await verifyLive(credential);
    return;
  }

  log('Menyiapkan kredensial openai-codex (langganan ChatGPT) untuk DeepSeek Harness');
  log(`  Store: ${CREDENTIALS_FILE}`);

  const credential = FROM_CODEX_CLI ? credentialFromCodexCli() : await deviceLogin();
  log(`  Akun : ${credential.accountId}`);
  log(`  Token: access ${redact(credential.access)}, berlaku s/d ${new Date(credential.expires).toISOString()}`);

  const alreadyStored = parseStoredCredential(original);
  if (alreadyStored) log(`  ! Record ${RECORD_KEY} sudah ada dan akan ditimpa.`);

  if (DRY_RUN) {
    log('  (dry-run) Blok yang akan ditulis (token disamarkan):');
    log(['records:', ...recordBlock({ ...credential, access: redact(credential.access), refresh: redact(credential.refresh) })].join('\n'));
    if (!NO_VERIFY) {
      log('  (dry-run) Melewati request verifikasi.');
    }
    return;
  }

  const next = upsertRecord(original, credential);
  validateEdit(original, next, credential, { expectNewRecord: !alreadyStored });
  const backup = writeCredentials(next, original);
  log(`  ✓ Tersimpan. Backup: ${backup}`);

  const route = describeRouteDeclaration();
  if (route.checked && route.declaredIn.length === 0) {
    log('  ! Route openai-codex belum ada di cordis.patch.yml profil mana pun.');
    log('    Tambahkan (lihat tutorial) lalu buka ulang aplikasi, atau tambahkan lewat Settings → Models.');
  }

  if (!NO_VERIFY) await verifyLive(credential);
  log('\nSelesai. Pilih model codex (mis. GPT-6.1 Sol) di model picker DSH, lalu kirim satu pesan.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
