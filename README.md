# 🎯 Suco+ (Smart Real-Time Multi-Target Tracking Radar & Multimodal AI Inspector)

[![Python Version](https://img.shields.io/badge/Python-3.9%2B-blue.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Flask Framework](https://img.shields.io/badge/Framework-Flask%203.x-lightgrey.svg?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Edge AI](https://img.shields.io/badge/Edge%20AI-TensorFlow.js%20COCO--SSD-orange.svg?logo=tensorflow&logoColor=white)](https://www.tensorflow.org/js)
[![Cloud AI](https://img.shields.io/badge/Cloud%20AI-Gemini%203.6%20Flash%20%7C%20DeepSeek-purple.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![Production Status](https://img.shields.io/badge/Production-Live%20on%20cPanel-success.svg?logo=cpanel&logoColor=white)](https://icom.co.id/sucoplus/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Suco+** adalah aplikasi web inspeksi cerdas berbasis kamera smartphone yang memadukan **Edge Computer Vision** lokal berkecepatan tinggi (30+ FPS) dengan sistem kunci radar militer (*Multi-Target Tracking*) dan **Multimodal Generative AI** (Google Gemini & DeepSeek) untuk menganalisis fisik, komponen, fungsi, serta karakteristik objek secara real-time dan bebas halusinasi.

---

## 🌐 Tautan Situs Web Aktif (Live Production)
Aplikasi telah dipublikasikan secara penuh dan dapat diakses langsung melalui peramban smartphone maupun desktop:  
👉 **[https://icom.co.id/sucoplus/](https://icom.co.id/sucoplus/)**

---

## a. JUDUL & DESKRIPSI PRODUK

### 1. Nama Produk Digital
**Suco+** (*Smart Ultrasonic & Computer Vision Object Detection and AI Multi-Target Inspector*)

### 2. Latar Belakang Masalah
Dalam operasional industri, pendidikan teknik, pergudangan, maupun aktivitas inventarisasi harian, kebutuhan mengidentifikasi dan menginspeksi objek atau komponen fisik sering menghadapi dilema teknologi:
1. **Keterbatasan Cloud Vision Murni:** Mengirimkan seluruh aliran video mentah (*live stream*) ke server kecerdasan buatan membutuhkan kuota data masif, menimbulkan latensi jaringan tinggi (1–3 detik per frame), dan terhenti total saat sinyal seluler di lapangan tidak stabil.
2. **Keterbatasan Detektor Objek Standar:** Model pengenal objek konvensional di browser hanya menghasilkan kotak batas (*bounding box*) statis tanpa kemampuan pelacakan konsisten saat kamera bergerak, serta tidak memiliki kecerdasan kognitif untuk menjelaskan kondisi fisik objek, mendeteksi cacat visual, atau menjawab pertanyaan teknis pengguna.
3. **Tantangan Akurasi & Halusinasi AI:** Asisten AI generatif sering kali mengalami *context drift* (menjawab melenceng dari objek yang sedang dilihat) atau berhalusinasi mengarang atribut komponen yang tidak tampak pada citra visual nyata.

### 3. Solusi yang Dihadirkan Suco+
Suco+ memecahkan permasalahan tersebut melalui pendekatan **Hybrid Edge-to-Cloud Architecture**:
* **Di Sisi Pengguna (Edge AI Browser):** Model TensorFlow.js COCO-SSD berakselerasi WebGL GPU memproses feed kamera lokal secara instan pada 30–60 FPS. Sistem pelacak target militer (*Multi-Target Tracking / MTT*) mengunci objek secara stabil (`TGT-01`, `TGT-02`), menghitung jarak optik, dan menyediakan pembesaran digital (*Digital Zoom* 1.0x–5.0x) tanpa menghabiskan kuota data internet.
* **Di Sisi Server (Cloud LMM Reasoning):** Hanya ketika pengguna menekan tombol inspeksi atau mengajukan pertanyaan, sistem mengambil snapshot resolusi tinggi dan mengirimkannya ke AI Router (Google Gemini 3.6 Flash & DeepSeek). Server menerapkan *Strict System Anchor Prompt* dan hyperparameter deterministik (`temperature: 0.1`) untuk memastikan jawaban 100% faktual, berbasis bukti visual (*visual grounding*), dan menolak topik di luar konteks pengamatan objek.

### 4. Target Pengguna
1. **Teknisi Lapangan & Operator Logistik:** Memeriksa identitas komponen mesin, inventarisasi barang di gudang, dan mencatat kondisi fisik aset.
2. **Siswa, Mahasiswa & Praktisi Vokasi:** Mempelajari pengenalan komponen perangkat keras/elektronika di laboratorium secara interaktif.
3. **Masyarakat Umum:** Pengenalan dan inspeksi cerdas terhadap berbagai objek harian di sekitar secara instan langsung dari peramban ponsel pintar tanpa perlu memasang aplikasi native.

---

## b. TEKNOLOGI YANG DIGUNAKAN

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ARSITEKTUR TEKNOLOGI SUCO+                      │
├────────────────────────────────────────────────────────────────────────┤
│  [ FRONTEND (Client Smartphone) ]                                      │
│  • JavaScript ES6+ (Modular IIFE: SucoCamera & SucoAPI)                │
│  • TensorFlow.js v4.20.0 + COCO-SSD v2.2.3 (lite_mobilenet_v2)         │
│  • WebGL GPU Acceleration (Inference Canvas Aspect-Ratio Preserved)    │
│  • Web Audio API (Triple-Tone Radar Synthesizer) & Haptic Vibration    │
│  • HTML5 Semantic & Responsive Dark-HUD CSS3 Styling                   │
│        │                                                               │
│        ▼ (HTTP REST API + Injeksi X-CSRFToken & Same-Origin Header)    │
│                                                                        │
│  [ BACKEND ENGINE (Server Flask) ]                                     │
│  • Python 3.10+ (Application Factory Pattern: create_app)              │
│  • Core Security: In-Memory Deque Rate Limiter & HMAC Constant-Time    │
│  • Image Verification: Pillow / PIL (Verifikasi Biner JPEG <= 2 MB)    │
│  • Database Connector: PyMySQL v1.1.0 (MySQL / MariaDB Ready)          │
│        │                                                               │
│        ▼ (Dual-Engine AI Router dengan Rollover Otomatis)              │
│                                                                        │
│  [ MULTIMODAL AI PROVIDERS ]                                           │
│  • Mesin Utama : Google Gemini 3.6 Flash REST API                      │
│  • Cadangan HA : DeepSeek-Chat (DeepSeek-V3) API                       │
│  • Fail-Safe   : Local Rule-Based Heuristic Expert (Zero-Downtime)     │
│        │                                                               │
│        ▼                                                               │
│  [ PLATFORM PUBLIKASI & DEPLOYMENT ]                                   │
│  • Localhost  : XAMPP (Apache/MySQL) & Python Virtualenv (Windows)     │
│  • Produksi   : cPanel Hosting Pribadi (https://icom.co.id/sucoplus/)  │
│  • WSGI Server: Phusion Passenger & LiteSpeed Enterprise Web Server    │
└────────────────────────────────────────────────────────────────────────┘
```

| Lapisan Sistem | Teknologi / Pustaka | Versi | Peran & Tanggung Jawab |
| :--- | :--- | :--- | :--- |
| **Bahasa Pemrograman** | Python | 3.9+ / 3.10 | Backend API RESTful, security middleware, AI routing orchestration. |
| | JavaScript | ES6+ Vanilla | Frontend client, kanvas radar HUD, streaming kamera, Web Audio synth. |
| | HTML5 / CSS3 | Standar Web | Struktur layout mobile-first, HUD neon militer, template Jinja2. |
| **Edge Computer Vision** | `@tensorflow/tfjs` | 4.20.0 | Inferensi tensor lokal dengan akselerasi WebGL GPU di browser. |
| | `@tensorflow-models/coco-ssd` | 2.2.3 | Deteksi 80 kelas objek real-time menggunakan arsitektur MobileNetV2. |
| **Backend Framework** | Flask | 3.0.3 | Web framework inti, routing Blueprint, template rendering Jinja2. |
| | Pillow (PIL) | 10.3.0 | Validasi biner integritas berkas citra snapshot JPEG dan filtering EXIF. |
| | requests | 2.31.0 | Klien HTTP timeout-controlled (20 detik) untuk komunikasi API LMM. |
| | python-dotenv | 1.0.1 | Manajemen variabel lingkungan `.env` aman (API key, secret key). |
| | PyMySQL | 1.1.0 | Driver basis data MySQL murni Python untuk riwayat telemetri. |
| **Model AI Eksternal** | Google Gemini 3.6 Flash | v1beta | Inferensi visual reasoning, analisis fisik objek, asisten Q&A. |
| | DeepSeek-Chat | v3 | Penyedia failover sekunder jika model Gemini mengalami latensi/kuota. |
| **Infrastruktur Publikasi** | Phusion Passenger | 6.x | WSGI Application Server pada hosting cPanel pribadi. |
| | LiteSpeed Web Server | Enterprise | Web Server performa tinggi dengan proteksi SSL HTTPS aktif. |

---

## c. PEMANFAATAN AI (AI USAGE DISCLOSURE)

Selaras dengan etika transparansi dan regulasi perlombaan, pengembangan produk ini mengintegrasikan kecerdasan buatan sebagai **mitra kolaborasi teknis (*intelligent co-pilot*)** dengan prinsip kendali penuh manusia (*Human-in-the-Loop*). Rincian kronologis lengkap tercatat pada berkas resmi [AI_LOGBOOK.md](AI_LOGBOOK.md).

### 1. Alat AI yang Digunakan
1. **Google Antigravity Agent (Google DeepMind):** Asisten arsitektur kode, penulisan kerangka modul dasar (*scaffolding*), perumusan matematika koordinat kanvas, dan audit keamanan.
2. **Google Gemini 3.6 Flash (REST API):** Mesin visual multimodal untuk inspeksi citra resolusi tinggi dan percakapan tanya-jawab interaktif.
3. **DeepSeek-Chat API:** Mesin penalaran teks cadangan untuk menjamin ketersediaan tinggi (*high availability*).
4. **TensorFlow.js COCO-SSD (Google TF Team):** Model deteksi objek edge di sisi peramban.

### 2. Contoh Perintah (Prompt) Utama Selama Pengembangan
Berikut adalah contoh perintah nyata yang diajukan tim saat berkolaborasi dengan asisten AI:

* **Tahap 1 (Eksplorasi Konsep Radar & Zoom):**
  > *"Kami ingin membuat sistem deteksi objek pada kamera smartphone yang mirip sistem radar pelacak target militer (ada locking, penomoran target TGT-01, estimasi jarak, dan multi-object). Bagaimana cara mengintegrasikan digital zoom 1.0x sampai 5.0x pada feed kamera canvas tanpa merusak sinkronisasi kotak deteksi objek?"*
* **Tahap 2 (Scaffolding Backend & Keamanan):**
  > *"Rancang arsitektur backend Python Flask menggunakan Application Factory create_app() dengan Blueprint terpisah untuk modul ai_snapshot. Buatkan middleware keamanan ketat: proteksi CSRF, Same-Origin check, dan Rate Limiter per IP tanpa memberatkan database."*
* **Tahap 3 (Debugging Galat cPanel & Sunset Model):**
  > *"Aplikasi berjalan lancar di XAMPP Windows tetapi mengalami error 500 Phusion Passenger saat diunggah ke cPanel LiteSpeed. Selain itu, API Gemini mengembalikan error 404 pada model 2.0-flash dan 503 pada model eksperimental. Bagaimana cara memperbaikinya?"*
* **Tahap 4 (Anti-Halusinasi & Zero-Drift Guardrail):**
  > *"Bagaimana cara mengunci respon AI agar 100% hanya menjawab hal-hal yang berkaitan dengan objek yang sedang dilihat kamera, menolak dengan sopan semua pertanyaan di luar konteks pengamatan objek (misal: pertanyaan politik/sejarah), dan tidak mengarang nomor seri mikro yang tidak terlihat di foto?"*

### 3. Penyesuaian & Perbaikan Mandiri oleh Peserta (*Human-in-the-Loop*)
Seluruh saran dari AI diuji dan disaring secara kritis oleh tim pengembang melalui modifikasi mandiri:
* **Koreksi Aspek Rasio Kamera Smartphone (9:16 Portrait):** AI awalnya mengasumsikan feed kamera berbentuk bujur sangkar atau 4:3. Peserta merekayasa fungsi mandiri `updateInferDimensions()` di [static/assets/js/camera.js](file:///c:/xampp/htdocs/sucoplus/static/assets/js/camera.js) yang menghitung rasio intrinsik video secara proporsional sehingga kotak bidik menempel presisi di layar HP.
* **Penolakan Auto-Dismiss Timer pada Kartu Objek:** AI mengusulkan timer `setTimeout(3000)` untuk menutup kartu saat objek hilang sesaat. Peserta **menolak saran tersebut** karena mengganggu operasional inspeksi di lapangan, lalu merancang **Persistent Object Detail Card** yang hanya dapat ditutup secara manual oleh pengguna dengan status *lost track tolerance*.
* **Rekayasa Rate Limiter Ringan In-Memory:** Alih-alih menggunakan library pihak ketiga `Flask-Limiter` yang membutuhkan dependensi Redis, peserta menulis modul `RateLimiter` murni berbasis *Thread-Safe In-Memory Deque* di [core/security.py](file:///c:/xampp/htdocs/sucoplus/core/security.py) agar efisien dan kompatibel di lingkungan cPanel.
* **Perbaikan WSGI Virtualenv & Logging cPanel:** Peserta memodifikasi [passenger_wsgi.py](file:///c:/xampp/htdocs/sucoplus/passenger_wsgi.py) dengan menyuntikkan interpreter virtual environment hosting secara dinamis dan menambahkan penangkap error mandiri ke `passenger_debug.log`.
* **Penguncian Suhu Deterministik 0.1 & Context Re-Anchoring:** Peserta menerapkan *Strict System Anchor Template*, menurunkan temperatur inferensi ke **0.1**, menyuntikkan prefix re-anchoring pada tiap pesan, dan memangkas riwayat chat ke **4 turn terakhir**, yang berhasil **menurunkan angka halusinasi dan respon melenceng hingga 0%**.

---

## d. PANDUAN PENGGUNAAN SISTEM

### 1. Menjalankan Program di Komputer Lokal (Localhost Python / XAMPP)

#### Prasyarat Sistem
* Python versi 3.9, 3.10, atau yang lebih baru.
* Web Browser modern yang mendukung WebGL dan WebRTC (Google Chrome, Microsoft Edge, atau Mozilla Firefox).
* Git terpasang di sistem.

#### Langkah Demi Langkah Menjalankan:
```bash
# 1. Kloning repositori proyek dari GitHub
git clone https://github.com/username/sucoplus.git
cd sucoplus

# 2. Buat lingkungan virtual Python (Virtual Environment)
python -m venv venv

# 3. Aktifkan virtual environment
# Pada Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# Pada Windows (Command Prompt):
.\venv\Scripts\activate.bat
# Pada Linux / macOS:
source venv/bin/activate

# 4. Pasang seluruh dependensi pustaka yang dibutuhkan
pip install -r requirements.txt

# 5. Salin dan konfigurasikan berkas variabel lingkungan (.env)
cp .env.example .env
# Edit file .env dan masukkan GEMINI_API_KEY Anda

# 6. Jalankan server pengembangan Flask
python app.py
```

Setelah server aktif, buka peramban Anda dan akses URL:  
👉 `http://127.0.0.1:5000/` atau `http://localhost:5000/`

---

### 2. Panduan Penggunaan Situs Web Aktif di Smartphone / Desktop

Bagi penguji atau pengguna yang ingin langsung mencoba tanpa instalasi lokal, kunjungi:  
🌐 **[https://icom.co.id/sucoplus/](https://icom.co.id/sucoplus/)**

```
┌────────────────────────────────────────────────────────────────────────┐
│                     ALUR INTERAKSI PENGGUNA (UX)                       │
├────────────────────────────────────────────────────────────────────────┤
│  1. Buka URL https://icom.co.id/sucoplus/ di Smartphone Chrome / Safari│
│        │                                                               │
│        ▼                                                               │
│  2. Berikan izin akses kamera perangkat saat pop-up browser muncul     │
│        │                                                               │
│        ▼                                                               │
│  3. Arahkan lensa kamera ke objek sekitar (ponsel, botol, buku, orang) │
│     -> Reticle Radar Militer (TGT-01) mengunci target secara otomatis  │
│     -> Nada konfirmasi audio dan getaran taktil aktif di smartphone    │
│        │                                                               │
│        ▼                                                               │
│  4. Gunakan slider "Digital Zoom" (1.0x s.d 5.0x) untuk objek berjarak │
│        │                                                               │
│        ▼                                                               │
│  5. Kartu informasi target muncul di layar bawah (Persistent Card)     │
│     Klik tombol "Analisis Detail AI" ────────────────┐                 │
│                                                      ▼                 │
│  6. Beralih ke Halaman Split-View (/objects/<id>/details)              │
│     • Sisi Kiri : Pan & Magnify visual snapshot resolusi tinggi        │
│     • Sisi Kanan: Ajukan pertanyaan teknis / gunakan tombol saran cepat│
│     • Ekspor    : Simpan rekaman dialog inspeksi via tombol unduh log  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## e. IDENTITAS PENGEMBANG

Aplikasi ini dikembangkan sebagai karya inovasi digital oleh:

1. **Fatikhul Azmi Aryasatya**  
   * **Kelas:** XI.F  
   * **Asal Sekolah:** SMAN 2 Kota Blitar  
   * **Peran:** Lead Developer, Edge AI & MTT Radar Engineer, Backend Architecture, cPanel Deployment.

2. **-**  
   * **Kelas:** XI.A  
   * **Asal Sekolah:** SMAN 2 Kota Blitar  
   * **Peran:** UI/UX Co-Designer, Quality Assurance & Mobile Hardware Field Testing.

---

### 📚 Berkas Dokumentasi Tambahan
* **[AI_LOGBOOK.md](AI_LOGBOOK.md)** &mdash; Dokumentasi resmi 4 tahapan interaksi AI (*Scaffolding*, *Debugging*, *Refleksi*, dan *Validasi Mandiri*).
* **[docs/project_context_specification.md](docs/project_context_specification.md)** &mdash; Spesifikasi teknis arsitektur kode, pohon direktori, dan standar konvensi sistem.

---
*Dibuat dengan dedikasi untuk kemajuan inovasi teknologi kecerdasan buatan Indonesia.*