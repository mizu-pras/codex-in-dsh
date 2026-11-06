# Tutorial: OpenAI Codex (langganan ChatGPT) di DeepSeek Harness

Panduan ini memasang provider **`openai-codex`** di DeepSeek Harness (DSH) memakai
**langganan ChatGPT (Plus/Pro)** — bukan API key, bukan billing API OpenAI.
Hasil akhirnya: model **GPT-6.1 Sol** dan model codex lain muncul di model picker DSH dan
bisa dipakai untuk coding agent.

Diuji untuk **DSH `0.2.1-rc.5` dan `0.2.2-rc.1` di macOS**. Berlaku sama untuk profil
`desktop` (aplikasi Desktop) maupun `web` (`dsh web`), dan untuk agent preset apa pun
(standard / cordis / Hermes) — route dan kredensial adalah konfigurasi **level profil**,
bukan level preset.

Berkas yang perlu dibawa ke komputer lain:

| Berkas | Fungsi |
|---|---|
| `TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md` | dokumen ini |
| `codex-oauth-login.mjs` | skrip login OAuth + penyimpan kredensial (tanpa dependensi) |

Perkiraan waktu: **3–5 menit** (mayoritas menunggu login di browser).

---

## 0. Ringkas: 3 langkah

1. **Deklarasikan route** `openai-codex` di profil DSH (lewat Settings → Models, atau 4 baris YAML).
2. **Login**: jalankan `node codex-oauth-login.mjs`, buka URL, masukkan kode, selesai.
3. **Verifikasi**: `node codex-oauth-login.mjs --verify`, lalu pilih **GPT-6.1 Sol** di DSH.

---

## 1. Yang perlu dan tidak perlu

| Perlu | Keterangan |
|---|---|
| Langganan ChatGPT dengan akses Codex (Plus/Pro) | Ini sumber autentikasinya. Akun gratis tidak bisa. |
| DSH terpasang dan **pernah dijalankan minimal sekali** | Agar `~/.dsh/.credentials.yaml` sudah dibuat oleh DSH. |
| Node.js ≥ 18 | Hanya untuk menjalankan skrip. DSH Desktop sudah membawa Node (lihat Troubleshooting). |

| Tidak perlu | Keterangan |
|---|---|
| `OPENAI_API_KEY` | Provider `openai-codex` **menolak** API key; ia OAuth-only. |
| Kartu kredit / saldo API | Pemakaian mengikuti kuota langganan ChatGPT. |
| Codex CLI | Opsional. Bisa dipakai sebagai sumber token alternatif (bagian 4b). |

Model yang bisa dipakai akun langganan (diuji 5 Nov 2026):

```
gpt-6.1-sol   gpt-6.1-terra  gpt-6-astra  gpt-6-sol  gpt-6-luna
gpt-5.6-sol   gpt-5.6-terra  gpt-5.6-luna
```

Katalog **pi-ai yang dibundel DSH adalah snapshot saat rilis**, jadi model yang dirilis
sesudahnya (mis. `gpt-6.1-terra`) tidak otomatis muncul. Cara menambahkannya ada di
[bagian 6](#6-model-baru-tidak-muncul-di-konfigurasi).

---

## 2. Langkah 1 — deklarasikan route `openai-codex`

Route harus ada di lapisan patch profil yang Anda jalankan:

```
~/.dsh/profiles/<profil>/cordis.patch.yml      # desktop untuk aplikasi Desktop, web untuk dsh web
```

Pilih **salah satu** cara berikut.

### Cara A — lewat GUI (tanpa edit file)

> Jalur ini mengikuti UI **Settings → Models** pada DSH 0.2.x. Kalau tombol/modenya tidak
> ada di versi Anda, gunakan Cara B.

1. Buka **Settings → Models**.
2. Klik **Add model provider** → pilih mode **Third-party model provider**.
3. Pada daftar provider katalog, pilih **`openai-codex`** (nama tampil: *OpenAI Codex (legacy)*).
4. **Save/Apply**. Tidak ada kolom API key untuk provider ini — memang begitu, karena
   autentikasinya OAuth. Yang disimpan hanya route + daftar model (warisan katalog).
5. Tutup dan buka ulang DSH Desktop (profil web: tunggu HMR ~2 detik atau restart `dsh web`).

### Cara B — edit file (deterministik, cocok untuk banyak komputer)

Tutup DSH Desktop dulu (atau siapkan restart), lalu buka
`~/.dsh/profiles/desktop/cordis.patch.yml`.

**Kalau sudah ada entry `- id: llm-pi-ai`**, cukup tambahkan satu baris di bawah
`providers:`:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      # tambahkan baris ini:
      openai-codex: {}
```

**Kalau belum ada entry itu**, tempel blok berikut di akhir file (file ini berupa array YAML):

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai-codex: {}
```

Catatan:

- `{}` berarti "pakai seluruh katalog pi-ai apa adanya": endpoint
  (`https://chatgpt.com/backend-api`), protokol (`openai-codex-responses`), dan 9 model
  diwarisi otomatis. Tidak perlu menulis daftar model.
- Jangan menulis `models:` kecuali Anda memang ingin **membatasi/mengubah** katalog,
  karena `models` **mengganti** seluruh katalog route itu, bukan menambah.
- Buka lagi DSH setelah menyimpan. (Profil `web` punya HMR, tapi restart tetap paling aman.)

### Cek route terpasang

```bash
node codex-oauth-login.mjs --print-path
# Route declared  : desktop
```

Kalau tertulis *"belum dideklarasikan"*, ulangi Langkah 1.

---

## 3. Langkah 2 — login dan simpan kredensial

> Di DSH `0.2.1-rc.5`/`0.2.2-rc.1` belum ada tombol "Sign in" untuk provider pi-ai di GUI
> (surface OAuth baru dipakai akun DeepSeek). Karena itu login dilakukan dengan skrip ini,
> memakai **device-code flow resmi OpenAI** yang sama dengan Codex CLI / pi-ai.

Jalankan dari folder tempat kedua berkas berada:

```bash
node codex-oauth-login.mjs
```

Alurnya:

1. Skrip mencetak tautan **https://auth.openai.com/codex/device** dan sebuah **kode**
   (format `XXXX-XXXXX`), dan mencoba membuka browser otomatis.
2. Buka tautan itu, login dengan akun ChatGPT Plus/Pro, masukkan kode, setujui.
3. Skrip menunggu (maks. 15 menit), menukar kode menjadi token, lalu menulis record
   `llm-pi-ai/openai-codex` ke `~/.dsh/.credentials.yaml`.
4. Terakhir skrip mengirim satu request kecil ke model codex sebagai verifikasi.

Contoh keluaran:

```
Menyiapkan kredensial openai-codex (langganan ChatGPT) untuk DeepSeek Harness
  Store: /Users/nama/.dsh/.credentials.yaml

  Buka tautan ini di browser:
    https://auth.openai.com/codex/device
  Lalu login dengan akun ChatGPT Plus/Pro dan masukkan kode:

    0GMC-UMBV2

  ✓ Login disetujui, token diterima.
  Akun : 12345678-....-9abcdef01234
  Token: access eyJh…4SEg (1778 karakter), berlaku s/d 2026-11-13T05:42:30.552Z
  ✓ Tersimpan. Backup: /Users/nama/.dsh/.credentials.yaml.bak.2026-11-05T...
  ✓ Request uji berhasil — model: gpt-6.1-sol, jawaban: "ok"

Selesai. Pilih model codex (mis. GPT-6.1 Sol) di model picker DSH, lalu kirim satu pesan.
```

Token **tidak pernah dicetak** utuh. File kredensial ditulis atomik dengan mode `0600`
dan backup otomatis.

### Opsi skrip

| Perintah | Gunanya |
|---|---|
| `node codex-oauth-login.mjs` | login + simpan + verifikasi (paling umum) |
| `node codex-oauth-login.mjs --dry-run` | login, tampilkan rencana penulisan (token disamarkan), **tidak menulis** |
| `node codex-oauth-login.mjs --verify` | tanpa login: cek record tersimpan, refresh bila hampir kedaluwarsa, lalu request uji |
| `node codex-oauth-login.mjs --print-path` | tampilkan lokasi store, record, dan profil yang mendeklarasikan route |
| `node codex-oauth-login.mjs --from-codex-cli` | impor token dari `~/.codex/auth.json` (Codex CLI) — lihat bagian 4b |
| `node codex-oauth-login.mjs --start-only` | hanya mencetak kode device lalu berhenti (debug / alur manual) |
| `--dsh-home <dir>` | kalau `DSH_HOME` bukan `~/.dsh` |
| `--no-browser` | jangan coba membuka browser |
| `--no-verify` | lewati request verifikasi (hemat kuota) |

---

## 4. Variasi

### 4a. Komputer lain / banyak mesin

Jalankan Langkah 1 + 2 **di setiap komputer**. Setiap mesin mendapat pasangan token OAuth
sendiri; token antar-mesin tidak saling mengganggu. Jangan menyalin
`~/.dsh/.credentials.yaml` antar mesin — Anda hanya perlu menyalin dua berkas tutorial ini.

### 4b. Impor token dari Codex CLI (tanpa browser)

Kalau komputer itu sudah login Codex CLI (`codex login`), tokennya ada di
`~/.codex/auth.json` dan bisa diimpor:

```bash
node codex-oauth-login.mjs --from-codex-cli
```

Konsekuensi yang perlu dipahami: DSH dan Codex CLI akan **berbagi satu refresh token**.
Refresh token OpenAI bersifat sekali pakai (dirotasi); kalau salah satu memperbarui token,
yang lain bisa perlu login ulang. Untuk pemakaian jangka panjang, cara utama
(device login) lebih aman karena DSH punya token sendiri.

### 4c. `DSH_HOME` custom

```bash
node codex-oauth-login.mjs --dsh-home "/path/ke/dsh-home"
```

---

## 5. Langkah 3 — verifikasi

### 5a. Lewat skrip

```bash
node codex-oauth-login.mjs --verify
#   Record ditemukan; token berlaku sampai 2026-11-13T05:42:30.552Z.
#   ✓ Request uji berhasil — model: gpt-6.1-sol, jawaban: "ok"
```

### 5b. Lewat GUI

1. Model picker di composer (atau `/model`) → pilih **GPT-6.1 Sol**
   (atau GPT-6 Sol / GPT-5.6 Sol / lainnya).
2. Kirim satu pesan pendek.

Kalau berhasil, tidak ada yang perlu di-restart: kredensial dibaca per request.

---

## 6. Model baru tidak muncul di konfigurasi

Gejala: model yang sudah ada di ChatGPT/Codex (mis. **GPT-6.1 Terra**) tidak muncul di model
picker DSH, padahal kredensial sudah benar.

Penyebab: DSH memakai katalog **pi-ai yang dibundel saat rilis** (snapshot), bukan katalog
live. Di profil, route juga bisa "dipaku" oleh daftar `models:` — dan `models:` **mengganti**
katalog route, bukan menambah. Jadi model yang rilis setelah snapshot harus ditambahkan
manual, atau tunggu DSH/pi-ai di-update.

### 6a. Pastikan id modelnya benar

Sumber paling akurat di mesin Anda adalah cache katalog Codex CLI:

```
~/.codex/models_cache.json
```

Atau minta skrip mencetak blok YAML siap tempel:

```bash
node codex-oauth-login.mjs --emit-models          # dari cache lokal
node codex-oauth-login.mjs --emit-models --probe  # hanya yang bisa dipakai akun Anda
```

`--probe` mengirim satu request kecil per model, sehingga id yang salah atau model yang tidak
diizinkan akun otomatis dibuang (mis. model khusus program tertentu).

Uji satu id tertentu tanpa menulis apa pun:

```bash
CODEX_TEST_MODEL=gpt-6.1-terra node codex-oauth-login.mjs --verify
```

### 6b. Tambahkan ke konfigurasi

**Lewat GUI** — Settings → Models → baris *OpenAI Codex (legacy)* → *Customized settings →
Model options* → tambah baris model (id, nama, context window, max token, input).
Catatan: GUI tidak menyediakan field `reasoningEfforts` untuk route katalog; untuk model di
luar katalog, tanpa field itu model dianggap **non-reasoning**.

**Lewat file** (disarankan bila ingin level reasoning penuh) — edit `models:` di
`cordis.patch.yml`:

```yaml
          - id: gpt-6.1-terra
            name: GPT-6.1 Terra
            contextWindow: 272000
            maxTokens: 128000
            input: [text, image]
            reasoningEfforts:
              'off': null
              low: low
              medium: medium
              high: high
              xhigh: xhigh
              max: max
```

`reasoningEfforts` hanya perlu untuk model **di luar katalog**; model yang ada di katalog
mewarisi level dari pi-ai bila field ini dihilangkan.

**Urutan di model picker mengikuti urutan entri `models:`** (bukan alfabetis, dan bukan
urutan dari OpenAI). Jadi untuk menyusun ulang tampilan, cukup pindahkan blok entri YAML-nya;
`--emit-models` sudah mencetak model dalam urutan prioritas Codex (GPT-6.1 Sol, GPT-6 Astra,
GPT-6.1 Terra, GPT-6 Sol, GPT-6 Luna, lalu GPT-5.6). Level yang dikenali DSH:
`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (nilai `ultra` milik Codex belum
didukung).

### 6c. Urutan aman

1. `--emit-models --probe` → simpan outputnya.
2. Tempel **menggantikan seluruh** daftar `models:` (bukan menambah baris di tengah), karena
   `models` bersifat replace.
3. Simpan. Profil dimuat ulang otomatis (HMR); kalau picker belum berubah, tutup & buka ulang
   aplikasi.
4. Pilih model baru → kirim satu pesan.

### 6d. Status model (per 5 Nov 2026, akun ChatGPT Plus/Pro)

Diuji langsung ke API Codex dengan kredensial yang sama:

| Model id | Status |
|---|---|
| `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | ✓ bisa dipakai |
| `gpt-daybreak-blue-latest` | ✗ “not authorized” untuk akun ini (program khusus) |
| `gpt-5.5`, `gpt-5.3-codex-spark` | ✗ tidak didukung lagi untuk akun ChatGPT |
| `gpt-6.1-luna` | ✗ **tidak ada**; yang tersedia `gpt-6-luna` |
| `gpt-reserve`, `codex-auto-review` | ada di API tetapi hidden/internal — tidak perlu ditambahkan |

`contextWindow: 272000` adalah tier harga dasar. Katalog Codex menyebut `500000` untuk
sebagian model; menaikkannya berarti request panjang masuk tier harga lebih tinggi.

---

## 7. Mode Fast & Ultrafast

OpenAI punya dua "mode cepat" untuk model GPT-6/GPT-5.6:

| Mode | Isi | Cara mengaktifkan di ekosistem Codex/ChatGPT |
|---|---|---|
| **Fast** | Sekitar 2–2.5× lebih cepat untuk GPT-6.1 Sol/Terra, GPT-6 Astra, GPT-6 Sol, GPT-6 Luna (GPT-5.6: 1.5×). Memakai kuota langganan 2.5× rate standar. | `/fast` di Codex CLI, atau `service_tier = "fast"` + `[features] fast_mode = true` di `~/.codex/config.toml`. Tersedia di Codex CLI, aplikasi ChatGPT desktop, dan IDE extension saat login ChatGPT. |
| **Ultrafast** | Tier tercepat; hanya GPT-6 Astra dan GPT-6.1 Sol (Astra sampai 8× lebih cepat). Memakai kuota 8× rate standar lalu kredit. | Hanya untuk plan **Pro $500** dan Enterprise/Edu yang memenuhi syarat; di Codex aktif lewat fitur `ultrafast_mode`. Plan self-serve lain belum mendapat akses. |

Sumber: [Speed (ChatGPT Learn)](https://learn.chatgpt.com/docs/agent-configuration/speed),
[Fast mode (API)](https://developers.openai.com/api/docs/guides/fast-mode),
[Ultrafast mode (API)](https://developers.openai.com/api/docs/guides/ultrafast-mode).

### Status di DSH 0.2.2-rc.1: belum bisa dipilih

- pi-ai sebenarnya mendukung `service_tier` (`options.serviceTier` → body `service_tier`),
  tetapi adapter **`dsh-llm-pi-ai` tidak meneruskannya**: tidak ada field `serviceTier` di
  Config provider maupun model. Audit kode: tidak ada satu pun paket `@deepseek-ai/dsh-*`
  yang menyebut `serviceTier` / `service_tier`.
- Akibatnya DSH selalu mengirim request **tanpa** `service_tier`, dan backend melayani
  `default`/`auto`. Ini bukan masalah kredensial atau daftar model.

### Hasil uji langsung dari mesin ini

Uji ke endpoint Codex langganan (`chatgpt.com/backend-api/codex/responses`) memakai skrip:

```bash
CODEX_TEST_MODEL=gpt-6.1-sol CODEX_SERVICE_TIER=priority node codex-oauth-login.mjs --verify
```

| Diminta | Diterima server? | Tier yang benar-benar dilayani |
|---|---|---|
| (tanpa `service_tier`) | ya | `default` |
| `priority` (nama Fast di API) | ya | `default` |
| `ultrafast` | ya | `default` |
| `fast` | **ditolak** — HTTP 400 `Unsupported service_tier: fast` | — |
| `flex` | ditolak — HTTP 400 | — |
| `default` | ya | `default` |

Dua catatan penting:

1. `fast`/`flex` adalah nama tier untuk **OpenAI API** (`api.openai.com`), bukan endpoint
   Codex langganan; di endpoint Codex nama yang dikenal `priority`, `ultrafast`, `default`.
2. Akun ini berplan `prolite` (terlihat di klaim JWT). Ultrafast mensyaratkan Pro $500,
   jadi kemungkinan besar memang tidak diberikan; Fast pun di sini dilayani `default`.

### Yang bisa dilakukan sekarang

1. **Pakai Codex CLI / aplikasi ChatGPT** untuk Fast mode (`/fast`). Di mesin ini fitur
   `fast_mode` dan `ultrafast_mode` sudah aktif (`codex features list`).
2. **Minta DSH menambahkan dukungan**: yang diperlukan adalah field `serviceTier` pada
   Config `llm-pi-ai` (level route atau model), pilihan di halaman Models, dan penerusan ke
   `options.serviceTier` pi-ai. Ini perubahan di upstream DSH/pi-ai, bukan di profil.
3. **Plugin adapter khusus** (route baru yang memanggil pi-ai dengan `serviceTier`) secara
   teori mungkin, tetapi berarti menduplikasi seluruh adapter DSH (auth, tools, image,
   replay). Hanya layak kalau Fast/Ultrafast wajib ada di dalam DSH.

Untuk memantau tier yang dilayani, skrip sekarang mencetak `service_tier` hasil respons
(`--verify`), dan menerima `--service-tier <priority|ultrafast|default>`.

---

## 8. Perawatan

- **Refresh otomatis.** Access token berumur ±10 hari. pi-ai me-refresh 5 menit sebelum
  kedaluwarsa memakai refresh token dan menulis balik record-nya. Tidak ada aksi manual.
- **Login ulang** (token dicabut, ganti akun, atau refresh gagal): jalankan lagi
  `node codex-oauth-login.mjs` — record lama ditimpa.
- **Ganti akun ChatGPT**: login ulang dengan akun lain saat device code; record ditimpa.
- **Copot kredensial**: hapus blok `llm-pi-ai/openai-codex` dari
  `~/.dsh/.credentials.yaml`, atau kembalikan dari file `.bak.*`.
- **Cek berkala**: `node codex-oauth-login.mjs --print-path` untuk melihat store & route.

---

## 9. Keamanan

- Record kredensial adalah **akses penuh ke akun ChatGPT Anda** di jalur Codex. Jangan
  bagikan `~/.dsh/.credentials.yaml` dan jangan commit ke git.
- File ditulis mode `0600`; backup `.bak.*` juga berisi token — hapus backup lama bila
  sudah tidak diperlukan.
- Skrip hanya berkomunikasi dengan `auth.openai.com` dan `chatgpt.com` (endpoint OpenAI).
  Tidak ada telemetri, tidak ada pengiriman token ke pihak lain.
- Bila token bocor: logout sesi di pengaturan akun ChatGPT (revoke), lalu login ulang
  (`--verify` akan gagal dengan `INVALID_CREDENTIAL` sampai login ulang dilakukan).
- Jangan memakai akun bersama/team tanpa izin admin; akses Codex mengikuti plan akun.

---

## 10. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Tidak menemukan ~/.dsh/.credentials.yaml` | DSH belum pernah dijalankan. Buka DSH (Desktop atau `dsh web`) sekali, lalu ulangi. |
| `node: command not found` | Pasang Node.js LTS (nodejs.org). macOS dengan DSH Desktop: pakai Node bawaan aplikasi (lihat di bawah). |
| Kode device ditolak / `HTTP 404` / loop terus | Akun tidak punya akses Codex (plan tidak memenuhi), atau device flow diblokir jaringan kantor. Coba browser lain/jaringan lain, atau `--from-codex-cli`. |
| `Provider is not configured: openai-codex` | Record kredensial tidak ada/tidak terbaca. Cek `--print-path`, jalankan `--verify`. Pastikan `DSH_HOME` yang dipakai sama dengan yang dipakai aplikasi. |
| Model codex tidak muncul di picker | Route belum terdeklarasi. Ulangi Langkah 1, lalu restart aplikasi. Cek `--print-path` → *Route declared*. |
| `INVALID_CREDENTIAL` | Token ditolak/dicabut. Login ulang. |
| `QUOTA` | Kuota Codex pada plan habis. Tunggu reset atau pakai akun/plan lain. |
| `HTTP 429` | Rate limit sesaat; tunggu lalu ulangi. |
| Model tertentu error "unknown model" | Model itu tidak tersedia untuk akun Anda. Hapus baris model itu dari `models:` (kalau Anda memakai daftar manual) atau pilih model lain. |
| Windows: `chmod` error | Diabaikan oleh skrip (mode file tidak berlaku di Windows). |
| Refresh gagal (`Refresh token ditolak`) | Jalankan login ulang; skrip tidak menulis apa pun saat refresh gagal. |

**Node bawaan DSH Desktop (macOS):**

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  codex-oauth-login.mjs
```

(Untuk Windows/Linux, jalur `resources/runtime/primary-runtime/dependencies/node/...`
berada di folder instalasi aplikasi; lebih mudah memasang Node.js LTS.)

---

## 11. Rollback

```bash
cp ~/.dsh/.credentials.yaml.bak.<stempel-waktu> ~/.dsh/.credentials.yaml
chmod 600 ~/.dsh/.credentials.yaml
```

Atau hapus blok `llm-pi-ai/openai-codex` dari file itu. Route di `cordis.patch.yml` boleh
tetap ada; tanpa kredensial, request codex akan kembali gagal dengan
`Provider is not configured: openai-codex`.

---

## Lampiran A — alur manual tanpa skrip

Untuk mesin yang tidak boleh menjalankan skrip. Butuh `curl` + editor teks.

1. Minta kode device:

```bash
curl -s -X POST https://auth.openai.com/api/accounts/deviceauth/usercode \
  -H 'content-type: application/json' \
  -d '{"client_id":"app_EMoamEEZ73f0CkXaXp7hrann"}'
```

Catat `device_auth_id` dan `user_code`. Buka <https://auth.openai.com/codex/device>,
login, masukkan kode.

2. Poll sampai disetujui (±15 menit):

```bash
curl -s -X POST https://auth.openai.com/api/accounts/deviceauth/token \
  -H 'content-type: application/json' \
  -d '{"device_auth_id":"<device_auth_id>","user_code":"<user_code>"}'
```

Selama belum disetujui akan muncul `deviceauth_authorization_pending` (HTTP 403).
Setelah disetujui: `authorization_code` + `code_verifier`.

3. Tukar menjadi token:

```bash
curl -s -X POST https://auth.openai.com/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'client_id=app_EMoamEEZ73f0CkXaXp7hrann' \
  -d 'code=<authorization_code>' \
  -d 'code_verifier=<code_verifier>' \
  -d 'redirect_uri=https://auth.openai.com/deviceauth/callback'
```

4. `accountId` = klaim `chatgpt_account_id` di dalam `https://api.openai.com/auth` pada
   JWT `access_token`. `expires` = sekarang (epoch ms) + `expires_in` × 1000.

5. Tambahkan blok berikut ke `~/.dsh/.credentials.yaml` (indentasi 2/4/6 spasi persis):

```yaml
records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:
      type: oauth
      access: '<access_token>'
      refresh: '<refresh_token>'
      expires: <epoch-milidetik>
      accountId: <chatgpt_account_id>
```

Hati-hati: YAML rusak akan membuat DSH gagal membaca seluruh credential store. Setelah
mengedit, jalankan `node codex-oauth-login.mjs --verify` untuk memastikan record terbaca
dan tokennya bekerja.

---

## Lampiran B — apa saja yang diubah skrip

| Objek | Perubahan |
|---|---|
| `~/.dsh/.credentials.yaml` | satu record `llm-pi-ai/openai-codex` (kind `grant`, payload OAuth pi-ai) |
| `~/.dsh/.credentials.yaml.bak.<stempel>` | backup sebelum penulisan |
| `cordis.patch.yml` | **tidak disentuh** — route dideklarasikan manual (Langkah 1) |
| Lainnya | tidak ada. Tidak ada file di luar DSH home yang diubah |

Record sengaja memakai format milik `dsh-llm-pi-ai`: scope `llm-pi-ai`, id provider
`openai-codex`, payload = objek OAuth pi-ai (`type`, `access`, `refresh`, `expires`,
`accountId`). Itulah yang dibaca adapter pi-ai saat me-refresh token.

---

## FAQ

**Perlu restart DSH setelah login?** Tidak — kredensial dibaca per request. Restart hanya
diperlukan setelah mengubah route di `cordis.patch.yml`.

**Bisakah dipakai bersama API key OpenAI?** Bisa, tetapi beda route: `openai-codex`
(langganan, OAuth) vs `openai` (API key, billing). Jangan menimpakan key ke route
`openai-codex` — provider itu menolak key eksplisit.

**Apakah token dipakai bersama Codex CLI?** Hanya jika memakai `--from-codex-cli`. Login
device-code menghasilkan token terpisah.

**Berapa biayanya?** Tidak ada biaya per token; memakai kuota langganan ChatGPT. Kalau
kuota habis, akan muncul `QUOTA`.

**Apakah aman untuk dibagikan tutorialnya?** Ya — dokumen dan skrip tidak memuat kredensial.
Jangan pernah membagikan `~/.dsh/.credentials.yaml`.

**Fast/Ultrafast tidak bisa dipilih?** Itu batasan DSH 0.2.2 (lihat
[bagian 7](#7-mode-fast--ultrafast)); pakai Codex CLI untuk sementara.

**Model baru tidak muncul?** Lihat [bagian 6](#6-model-baru-tidak-muncul-di-konfigurasi) —
pakai `--emit-models --probe`, lalu tempel daftar `models:` yang baru.

**Bagaimana kalau DSH versi lain?** Mekanismenya (pi-ai `openai-codex` + credential store
`~/.dsh/.credentials.yaml`) stabil di rilis 0.2.x. Kalau lokasi store berbeda, gunakan
`--dsh-home` atau sesuaikan; jangan menebak — cek `node codex-oauth-login.mjs --print-path`.
