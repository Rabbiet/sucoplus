# PROTOKOL DOKUMENTASI STRUKTUR & KODE PROYEK (ANTIGRAVITY CONTEXT SPEC)

Dokumen ini memetakan arsitektur direktori, alur data, inventarisasi modul, dan relasi kode aktual untuk sistem **Suco+** (Real-Time Object Detection & AI Router) sebagai referensi standar proyek.

---

## 1. STRUKTUR POHON DIREKTORI (FILE TREE)

```text
sucoplus/
├── core/                              # Modul inti keamanan, utilitas & middleware
│   ├── __init__.py                    # Inisialisasi package core
│   └── security.py                    # Rate limiter, Same-Origin & CSRF validator, sanitasi input
├── docs/                              # Dokumentasi teknis & spesifikasi proyek
│   └── project_context_specification.md
├── routes/                            # Blueprint routing API backend
│   ├── __init__.py                    # Inisialisasi package routes
│   └── ai_snapshot.py                 # Endpoint snapshot image & AI Router (Gemini/DeepSeek fallback)
├── static/                            # Asset front-end client-side
│   └── assets/
│       ├── css/
│       │   └── style.css              # Styling mobile-first, dark-theme HUD & responsive grid
│       ├── img/
│       │   └── .gitkeep               # Placeholder direktori gambar statis
│       └── js/
│           ├── api.js                 # Wrapper Vanilla JS fetch, CSRF injection & base path resolver
│           └── camera.js              # Multi-target tracking radar engine, TF.js COCO-SSD & WebGL
├── templates/                         # Template Jinja2 Flask
│   └── index.html                     # Halaman tunggal UI radar, kamera stream & panel kontrol AI
├── tmp/                               # Direktori runtime Passenger WSGI
│   ├── .gitkeep
│   └── restart.txt                    # Trigger reload aplikasi Passenger WSGI cPanel
├── uploads/                           # Penyimpanan berkas upload dinamis
│   └── snapshots/
│       └── .gitkeep                   # Direktori penyimpanan snapshot JPEG tervalidasi
├── .env                               # Konfigurasi environment lokal (kunci API, database, secret)
├── .env.example                       # Template konfigurasi variabel lingkungan
├── .gitignore                         # Pengabaian git (venv, __pycache__, upload cache, .env)
├── app.py                             # Application Factory Flask (create_app) & global WSGI instance
├── passenger_wsgi.py                  # Entry point produksi untuk cPanel Phusion Passenger/LiteSpeed
└── requirements.txt                   # Spesifikasi dependensi Python backend
```

---

## 2. METADATA STACK & ENVIRONMENT

* **Bahasa Pemrograman & Versi:** Python 3.9+ (Backend) / JavaScript ES6+ Vanilla JS (Frontend Client)
* **Framework / Runtime:** Flask 3.x (WSGI Application Factory) / LiteSpeed Web Server + Phusion Passenger
* **Client-Side AI Engine:** TensorFlow.js v4.20.0 (`@tensorflow/tfjs`) + COCO-SSD Model v2.2.3 (`lite_mobilenet_v2`) via WebGL GPU Backend
* **Database & ORM/ODM:** PyMySQL v1.1.0 (Prepared untuk MySQL / MariaDB) & Flask Client-Side Session Cookies
* **State Management / Cache:**
  * Backend: In-Memory Thread-Safe Deque (`collections.deque` + `threading.Lock`) untuk Rate Limiting per IP
  * Frontend: In-Memory Multi-Target Tracking Map (`activeTracks = new Map()`) + Hysteresis Sticky Target Tracker
* **Package Manager:** Python `pip` (Virtualenv) / Frontend CDN Libraries
* **Pustaka Utama (Key Dependencies):**
  * `Flask` (>=2.3.0,<4.0.0) -> Routing REST API, context processor, template rendering, and session security.
  * `python-dotenv` (>=1.0.0) -> Memuat variabel konfigurasi dari berkas `.env` ke `os.environ`.
  * `requests` (>=2.31.0) -> HTTP client untuk integrasi REST API ke Google Gemini 2.0 Flash & DeepSeek Chat API dengan timeout terkontrol (20 detik).
  * `Pillow` (>=10.0.0) -> Validasi biner integritas gambar snapshot (`img.verify()`), pembatasan ukuran maksimal 2 MB, dan verifikasi format asli JPEG.
  * `PyMySQL` (>=1.1.0) -> Driver basis data MySQL/MariaDB murni Python untuk integrasi relasional data pengguna/riwayat deteksi.
  * `fpdf2` (>=2.7.5) -> Generator dokumen PDF untuk pelaporan log deteksi dan telemetri (modul ekspansi).

---

## 3. INVENTARISASI MODUL & ENTRY POINTS

| File Path | Peran / Tanggung Jawab | Ekspor Kunci (Functions, Classes, Types) | Modul yang Mengimpornya |
| :--- | :--- | :--- | :--- |
| `passenger_wsgi.py` | Entry point server produksi cPanel LiteSpeed / Passenger | `application` | Phusion Passenger Daemon |
| `app.py` | Application Factory, context processor, error handlers, static asset helpers | `create_app()`, `app` | `passenger_wsgi.py`, Unit Test |
| `core/security.py` | Lapisan pertahanan keamanan: Rate Limiting, Same-Origin, CSRF, sanitasi | `require_api_security()`, `sanitize_filename()`, `mask_secret()`, `sanitize_csv_cell()` | `app.py`, `routes/ai_snapshot.py` |
| `routes/ai_snapshot.py` | Blueprint API snapshot penyimpanan biner & AI Router auto-fallback | `ai_snapshot_bp`, `save_snapshot()`, `analyze_ai()`, `_call_gemini()`, `_call_deepseek()` | `app.py` |
| `static/assets/js/api.js` | Klien HTTP Frontend: Base path resolving, CSRF token injection, fetch wrapper | `window.SucoAPI` (`saveSnapshot`, `analyzeAI`, `pingSecure`, `checkHealth`), `ApiError` | `camera.js`, `index.html` |
| `static/assets/js/camera.js` | Modul kamera, TF.js COCO-SSD, Multi-Target Radar Engine (MTT), Audio Synth & Haptic | `window.SucoCamera` (`startCamera`, `stopCamera`, `switchCamera`, `pinTarget`, `captureSnapshot`) | `index.html` |
| `templates/index.html` | Layout antarmuka utama pengguna (Viewport, Stage Kamera, Toolbar Radar, AI Form) | Jinja2 Template View | `app.py` (`index()`) |
| `static/assets/css/style.css` | Desain antarmuka responsif mobile (Portrait 3:4 / Landscape 16:9), dark-theme HUD | CSS Ruleset & Media Queries | `templates/index.html` |

---

## 4. RELASI & ALUR KERJA ANTAR-FILE (FLOW MAP)

```
[ Smartphone / Browser Client ]
       │
       ├── 1. TF.js WebGL (camera.js) ──> Deteksi Objek Lokal COCO-SSD (Multi-Target Radar HUD)
       │
       ├── 2. HTTP POST /api/snapshot/save 
       │       │
       │       ▼ (Injeksi X-CSRFToken & Base Path via api.js)
       │
[ cPanel / Passenger WSGI (passenger_wsgi.py) ]
       │
       ▼
[ Flask Application Factory (app.py) ]
       │
       ├── 3. Middleware Keamanan (core/security.py)
       │       ├── Check 1: Rate Limiter per Client IP (HTTP 429 jika melebihi batas)
       │       ├── Check 2: Same-Origin Check via Origin/Referer (HTTP 403)
       │       └── Check 3: CSRF Token Session vs Header via hmac.compare_digest (HTTP 403)
       │
       ▼
[ Route Handler (routes/ai_snapshot.py) ]
       │
       ├── A. Alur Snapshot (`save_snapshot`)
       │       ├── Validasi Payload Base64 & Verifikasi Header Biner JPEG (Pillow) <= 2 MB
       │       ├── Sanitasi Nama Berkas (`sanitize_filename`) -> `snap_YYYYMMDD_HHMMSS_<uuid>.jpg`
       │       └── Simpan ke `uploads/snapshots/` -> Balas URL statis (HTTP 201)
       │
       └── B. Alur AI Router (`analyze_ai`)
               ├── Susun Prompt Terstruktur (Daftar Multi-Target COCO-SSD + Instruksi User)
               ├── Coba Provider Utama (Google Gemini 2.0 Flash REST API) [Timeout = 20s]
               └── Jika Gagal / Timeout ──> Auto-Fallback ke Provider Sekunder (DeepSeek Chat API)
                       │
                       ▼
               Balas Hasil Analisis JSON ke Client (HTTP 200)
```

---

## 5. STANDARDISASI KODE & KONVENSI PROYEK

* **Pola Penamaan File:**
  * Python: `snake_case` (contoh: `security.py`, `ai_snapshot.py`, `passenger_wsgi.py`).
  * JavaScript & CSS: `kebab-case` atau `lowercase` (contoh: `api.js`, `camera.js`, `style.css`).
  * Template: `snake_case.html` (contoh: `index.html`).
* **Pola Ekspor:**
  * Python: Eksport fungsi dan blueprint secara eksplisit (`ai_snapshot_bp`, `create_app`).
  * JavaScript: Pola IIFE (*Immediately Invoked Function Expression*) dengan objek read-only beku (*frozen namespace*) yang diekspos ke objek `window` (`window.SucoCamera` dan `window.SucoAPI`).
* **Error Handling Strategy:**
  * Python: Decorator wrapper terpusat (`require_api_security`) dengan balasan format standar JSON `{ "status": "error", "message": "..." }`, penanganan exception LLM dengan auto-fallback antarprivider, dan boundary handler `@app.errorhandler(404, 500)`.
  * JavaScript: Custom error class `ApiError` yang mengekstrak kode status HTTP, `retry_after`, dan pesan terperinci dari backend; fallback audio & permission handling yang ramah pengguna.
* **Aturan Impor:**
  * Python: Menggunakan relative/absolute package import standar (`from core.security import ...`, `from routes.ai_snapshot import ...`).
  * Frontend: Resolver dinamis `window.BASE_PATH` dan helper Jinja2 `{{ asset_url('...') }}` yang menyertakan query string versi berbasis *file modification time* (`?v=<mtime>`) untuk mencegah masalah browser caching saat deployment.

---

## 6. BATASAN & LARANGAN KHUSUS (PROJECT CONSTRAINTS)

* **Integritas Entry Point:** File `passenger_wsgi.py` wajib selalu mengekspor objek instance WSGI dengan nama `application` (`from app import app as application`) agar kompatibel dengan LiteSpeed Phusion Passenger cPanel.
* **Manajemen Dependensi:** Dilarang menambahkan pustaka eksternal pada backend tanpa mencatatnya di `requirements.txt`.
* **Protokol Keamanan API:** Setiap endpoint API publik bertipe `POST` wajib diberi decorator `@require_api_security` untuk mencegah serangan CSRF, Path Traversal, Brute-force/DDoS (Rate Limiter), dan Formula Injection.
* **Format Output Respons API:** Wajib mematuhi format JSON Strict dengan atribut status utama:
  ```json
  {
    "status": "ok" | "error",
    "message": "Deskripsi respon",
    "...": "Data tambahan relevan"
  }
  ```
* **Kamera & Rasio Aspek AI:** Resolusi inferensi kanvas COCO-SSD wajib mempertahankan rasio aspek intrinsik video kamera (`updateInferDimensions()`) untuk mencegah distorsi citra pada smartphone dengan orientasi portrait (9:16).
