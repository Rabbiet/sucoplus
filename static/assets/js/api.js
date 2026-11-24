/**
 * Suco+ API Client Module (Vanilla JS Fetch Wrapper)
 * Menangani komunikasi asynchronous ke backend Flask:
 * 1. Resolusi URL otomatis menggunakan window.BASE_PATH (mendukung subfolder cPanel).
 * 2. Injeksi otomatis CSRF Token via header 'X-CSRFToken' (dari window.CSRF_TOKEN atau meta tag).
 * 3. Standardisasi handling respons JSON, status error (400, 403, 429, 500, 502), dan timeout.
 */

(function (window) {
    'use strict';

    /**
     * Mengambil base path aplikasi tanpa trailing slash.
     * @returns {string}
     */
    function getBasePath() {
        if (typeof window.BASE_PATH === 'string') {
            return window.BASE_PATH.replace(/\/+$/, '');
        }
        return '';
    }

    /**
     * Mengambil CSRF token aktif dari session/window atau tag meta.
     * @returns {string}
     */
    function getCSRFToken() {
        if (typeof window.CSRF_TOKEN === 'string' && window.CSRF_TOKEN.trim() !== '') {
            return window.CSRF_TOKEN.trim();
        }
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag && metaTag.getAttribute('content')) {
            return metaTag.getAttribute('content').trim();
        }
        return '';
    }

    /**
     * Membangun URL absolut/relatif yang aman dengan base path aplikasi.
     * @param {string} endpoint
     * @returns {string}
     */
    function buildUrl(endpoint) {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        const base = getBasePath();
        return base ? `${base}${cleanEndpoint}` : cleanEndpoint;
    }

    /**
     * Custom Error class untuk penanganan respon API Suco+
     */
    class ApiError extends Error {
        constructor(message, status = 0, data = null) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.data = data;
            this.retryAfter = data && data.retry_after ? Number(data.retry_after) : null;
        }
    }

    /**
     * Wrapper utama pemanggilan fetch dengan proteksi Same-Origin dan CSRF.
     * @param {string} endpoint - Path endpoint API (contoh: '/api/snapshot/save')
     * @param {Object} [options={}] - Opsi Fetch API standar
     * @returns {Promise<any>}
     */
    async function request(endpoint, options = {}) {
        const url = buildUrl(endpoint);
        const headers = new Headers(options.headers || {});

        // Set default Content-Type ke application/json jika ada payload body JSON
        if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        // Injeksi header CSRF Token untuk proteksi Same-Origin POST/PUT/DELETE
        const token = getCSRFToken();
        if (token) {
            headers.set('X-CSRFToken', token);
        }

        // Permintaan Same-Origin dengan kredensial cookie sesi
        const fetchConfig = {
            ...options,
            headers: headers,
            credentials: 'same-origin',
        };

        let response;
        try {
            response = await fetch(url, fetchConfig);
        } catch (netError) {
            throw new ApiError(
                'Gagal terhubung ke server Suco+. Periksa koneksi jaringan Anda.',
                0,
                { originalError: netError.message }
            );
        }

        // Parsing respons JSON secara aman
        let data = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch (jsonErr) {
                data = null;
            }
        }

        // Tangani status HTTP error
        if (!response.ok) {
            let errorMsg = 'Terjadi kesalahan pada permintaan API.';

            if (data && data.message) {
                errorMsg = data.message;
            } else if (response.status === 403) {
                errorMsg = 'Akses ditolak: Validasi keamanan CSRF atau Origin gagal.';
            } else if (response.status === 429) {
                const retry = data && data.retry_after ? ` Coba lagi dalam ${data.retry_after} detik.` : '';
                errorMsg = `Terlalu banyak permintaan (Rate Limit exceeded).${retry}`;
            } else if (response.status === 502) {
                errorMsg = 'Provider AI gagal memberikan respons. Silakan coba kembali.';
            } else if (response.status === 404) {
                errorMsg = 'Endpoint API tidak ditemukan.';
            } else if (response.status >= 500) {
                errorMsg = 'Terjadi kesalahan pada internal server Suco+.';
            }

            throw new ApiError(errorMsg, response.status, data);
        }

        return data;
    }

    /**
     * Objek SucoAPI yang diekspos secara global
     */
    const SucoAPI = {
        getBasePath,
        getCSRFToken,
        buildUrl,
        ApiError,

        /**
         * Menguji koneksi dan status keamanan CSRF / Rate Limiting.
         * @returns {Promise<{status: string, message: string}>}
         */
        async pingSecure() {
            return request('/api/ping-secure', {
                method: 'POST',
                body: JSON.stringify({}),
            });
        },

        /**
         * Mengecek endpoint kesehatan server.
         * @returns {Promise<any>}
         */
        async checkHealth() {
            return request('/health', {
                method: 'GET',
            });
        },

        /**
         * Menyimpan snapshot kamera (Base64 JPEG) ke server backend.
         * @param {string} base64Image - Data URI atau Base64 mentah format image/jpeg
         * @returns {Promise<{status: string, message: string, filename: string, url: string, size_bytes: number}>}
         */
        async saveSnapshot(base64Image) {
            if (!base64Image || typeof base64Image !== 'string') {
                throw new ApiError('Format gambar snapshot tidak valid.', 400);
            }

            return request('/api/snapshot/save', {
                method: 'POST',
                body: JSON.stringify({ image: base64Image }),
            });
        },

        /**
         * Mengirimkan data deteksi COCO-SSD dan snapshot ke AI Router (Gemini <-> DeepSeek).
         * @param {Object} params
         * @param {Array<Object>} [params.detections=[]] - Hasil deteksi objek dari TensorFlow.js
         * @param {string} [params.prompt=''] - Instruksi tambahan dari pengguna
         * @param {string|null} [params.image=null] - Snapshot Base64 JPEG opsional
         * @returns {Promise<{status: string, provider_used: string, fallback_triggered: boolean, analysis: string}>}
         */
        async analyzeAI({ detections = [], prompt = '', image = null } = {}) {
            const payload = {
                detections: Array.isArray(detections) ? detections : [],
                prompt: typeof prompt === 'string' ? prompt.trim() : '',
            };

            if (image && typeof image === 'string') {
                payload.image = image;
            }

            return request('/api/ai/analyze', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        },
    };

    // Lindungi objek dari modifikasi runtime tidak sengaja
    Object.freeze(SucoAPI);

    // Daftarkan ke window global
    window.SucoAPI = SucoAPI;

})(typeof window !== 'undefined' ? window : this);
