/**
 * Suco+ Camera & Real-Time Multi-Object Detection Module
 * Menggunakan Vanilla JS + TensorFlow.js COCO-SSD + Military Multi-Target Tracking (MTT) Radar Engine
 * 
 * Implementasi Spesifikasi Lengkap:
 * 1. Integrasi Halaman Detail Objek & AI Q&A System:
 *    - Freeze-frame crop snapshot resolusi tinggi dari bounding box objek yang terkunci.
 *    - Serialisasi konteks lengkap (LockedObjectContextPayload) ke sessionStorage.
 *    - Transisi navigasi mulus ke rute /objects/:objectId/details.
 *    - Pemulihan otomatis status kamera dan zoom (suco_camera_restore_state) saat kembali ke live-view.
 * 2. Digital Zoom Multi-Objek (Region of Interest / RoI Cropping & Coordinate Re-projection):
 *    - Pembesaran digital 1.0x hingga 5.0x dengan titik fokus (Cx, Cy) dinamis.
 *    - Sub-frame cropping pada kanvas inferensi untuk meningkatkan ketajaman objek kecil/jauh.
 *    - Transformasi koordinat viewport sesuai Formula 3.1:
 *        X_screen = (bx - Cx) * S + W_viewport / 2
 *        Y_screen = (by - Cy) * S + H_viewport / 2
 *    - Kontrol zoom interaktif: Tombol preset (1x, 2x, 3x, 5x), wheel scroll, touch pinch, dan tombol "Zoom ke Objek".
 * 3. Persistent Object Detail Card (Manual Close Policy Only):
 *    - Pemisahan total antara Transient Frame State dan Persistent UI Selection State.
 *    - Sekali objek dipin/diklik, kartu deskripsi TIDAK AKAN HILANG meskipun objek sementara keluar frame atau occluded.
 *    - Hanya dapat ditutup melalui tombol eksplisit "Tutup Deskripsi" (dismissPinnedObject).
 * 4. Multi-Target Tracking (MTT) Radar:
 *    - Pelacakan banyak objek sekaligus (TGT-01, TGT-02, dst.) dengan target prioritas otomatis & manual.
 *    - Telemetri taktis militer (Range estimasi, Azimuth/Bearing, kuncian 0-100%).
 * 5. Audio Synthesizer (Web Audio API) & Haptic Vibration Ponsel.
 * 6. Integrasi Cerdas AI Router (Gemini & DeepSeek Auto-Fallback).
 */

(function (window, document) {
    'use strict';

    // ==========================================
    // 1. STATE INTERNAL MODUL & MULTI-TARGET ENGINE
    // ==========================================
    let model = null;
    let modelPromise = null;
    let stream = null;
    let isDetecting = false;
    let isInferring = false;
    let animationFrameId = null;
    let lastRenderTime = performance.now();
    let frameCount = 0;
    let currentFps = 0;
    let lastFpsUpdate = performance.now();
    let latestDetections = [];

    // Dimensi kanvas inferensi dinamis proporsional
    let maxInferDimension = (typeof window !== 'undefined' && window.innerWidth < 640) ? 300 : 360;
    let inferWidth = 320;
    let inferHeight = 240;
    let inferCanvas = null;
    let inferCtx = null;

    // Mode kamera: default ke 'environment' (kamera belakang smartphone)
    let currentFacingMode = 'environment';

    // Parameter Akurasi Deteksi & Responsivitas
    const MAX_DETECTIONS = 12;
    const MIN_CONFIDENCE_SCORE = 0.35;
    const MIN_BOX_AREA_RATIO = 0.012;

    // ==========================================
    // 2. STATE DIGITAL ZOOM & PERSISTENT CARD
    // ==========================================

    /**
     * Konfigurasi & State Digital Zoom (Viewport State)
     */
    const zoomViewportState = {
        scale: 1.0,                 // Faktor perbesaran (1.0x - 5.0x)
        minScale: 1.0,
        maxScale: 5.0,
        centerPoint: {              // Titik fokus tengah (Cx, Cy) dalam piksel canvas
            x: 320,
            y: 240,
        },
        isZooming: false,
    };

    /**
     * State Persistensi UI Kartu Detail Objek (Manual Close Only)
     */
    const persistentUIState = {
        pinnedObjectId: null,       // ID objek yang sedang dipin (contoh: 'TGT-01')
        pinnedObjectData: null,     // Snapshot data objek lengkap (kebal re-render frame)
        isDetailVisible: false,     // Visibilitas kartu (hanya false saat user klik 'Tutup')
    };

    // Konfigurasi Sistem Multi-Target Radar
    const radarConfig = {
        enabled: true,              // Tampilkan overlay Radar HUD
        soundEnabled: true,         // Aktifkan audio synthesizer radar
        hapticEnabled: true,        // Aktifkan getaran haptic smartphone
        autoAiOnLock: false,        // Otomatis kirim ke AI Router saat target prioritas LOCKED
        lockHoldThresholdMs: 1200,  // Durasi bidik sebelum status menjadi LOCKED (1.2 detik)
        autoAiCooldownMs: 8000,     // Jeda waktu minimum antar pemanggilan auto AI (8 detik)
        maxTrackMemoryMs: 450,      // Grace period saat objek terhalang sesaat agar ID tidak hilang
    };

    // Struktur Penyimpanan Multi-Target Tracking (MTT)
    const activeTracks = new Map();
    let nextTargetCounter = 1;
    let priorityTargetId = null;
    let userPinnedTargetId = null;
    let lastPriorityAnnouncedId = null;
    let lastAutoAiTrigger = 0;
    let sweepAngle = 0;

    // Web Audio API Synthesizer Context
    let audioContext = null;

    // ==========================================
    // 3. KAMUS PENGETAHUAN OBJEK (BAHASA INDONESIA)
    // ==========================================
    const OBJECT_DESCRIPTIONS = {
        'person': {
            label: 'Manusia / Orang',
            icon: '👤',
            desc: 'Individu atau orang yang berada dalam jangkauan kamera pengawasan.',
        },
        'cell phone': {
            label: 'Ponsel / Smartphone',
            icon: '📱',
            desc: 'Perangkat komunikasi genggam elektronik untuk telepon, komputasi portabel & media.',
        },
        'bottle': {
            label: 'Botol Minum / Wadah',
            icon: '🍾',
            desc: 'Wadah silinder penyimpan cairan atau air minum berbahan plastik/kaca.',
        },
        'cup': {
            label: 'Cangkir / Gelas',
            icon: '☕',
            desc: 'Wadah minuman berukuran kecil untuk konsumsi air panas atau dingin.',
        },
        'laptop': {
            label: 'Komputer Jinjing (Laptop)',
            icon: '💻',
            desc: 'Perangkat komputer portabel dengan keyboard dan layar untuk bekerja dan komputasi.',
        },
        'mouse': {
            label: 'Tetikus (Mouse)',
            icon: '🖱️',
            desc: 'Perangkat input periferal komputer untuk mengontrol kursor navigasi.',
        },
        'keyboard': {
            label: 'Papan Ketik (Keyboard)',
            icon: '⌨️',
            desc: 'Alat input teks dan kontrol pintasan untuk komputer atau mesin kerja.',
        },
        'book': {
            label: 'Buku / Dokumen',
            icon: '📖',
            desc: 'Kumpulan lembaran kertas bertuliskan teks bacaan, catatan, atau referensi.',
        },
        'chair': {
            label: 'Kursi',
            icon: '🪑',
            desc: 'Furnitur tempat duduk berpunggung yang dirancang untuk satu orang.',
        },
        'couch': {
            label: 'Sofa / Tempat Duduk',
            icon: '🛋️',
            desc: 'Tempat duduk santai berlapis busa empuk untuk beberapa orang.',
        },
        'potted plant': {
            label: 'Tanaman Hias (Pot)',
            icon: '🪴',
            desc: 'Vegetasi atau tanaman hijau dalam pot untuk dekorasi dalam ruangan.',
        },
        'dining table': {
            label: 'Meja Makan / Kerja',
            icon: '🪵',
            desc: 'Furnitur dengan permukaan datar berkaki untuk makan atau menaruh peralatan.',
        },
        'tv': {
            label: 'Televisi / Monitor',
            icon: '📺',
            desc: 'Layar monitor elektronik penerima tampilan visual atau display komputer.',
        },
        'backpack': {
            label: 'Tas Ransel',
            icon: '🎒',
            desc: 'Tas kain berpenopang bahu untuk membawa barang bawaan secara portabel.',
        },
        'handbag': {
            label: 'Tas Tangan / Jinjing',
            icon: '👜',
            desc: 'Tas jinjing tangan untuk menyimpan perlengkapan pribadi.',
        },
        'umbrella': {
            label: 'Payung',
            icon: '☂️',
            desc: 'Alat pelindung dari hujan atau panas terik matahari berbahan tahan air.',
        },
        'clock': {
            label: 'Jam Dinding / Meja',
            icon: '⏰',
            desc: 'Instrumen penunjuk dan pengukur waktu mekanik atau digital.',
        },
        'scissors': {
            label: 'Gunting',
            icon: '✂️',
            desc: 'Alat perkakas genggam pemotong kertas atau kain dengan dua bilah tajam berporos.',
        },
        'remote': {
            label: 'Pengendali Jarak Jauh (Remote)',
            icon: '🎛️',
            desc: 'Perangkat nirkabel inframerah/bluetooth untuk mengoperasikan alat elektronik.',
        },
        'car': {
            label: 'Mobil',
            icon: '🚗',
            desc: 'Kendaraan bermotor darat roda empat untuk transportasi penumpang dan barang.',
        },
        'motorcycle': {
            label: 'Sepeda Motor',
            icon: '🏍️',
            desc: 'Kendaraan bermotor roda dua bertenaga mesin untuk mobilitas jalan raya.',
        },
        'bicycle': {
            label: 'Sepeda',
            icon: '🚲',
            desc: 'Kendaraan roda dua ramah lingkungan yang digerakkan oleh kayuhan kaki.',
        },
        'cat': {
            label: 'Kucing',
            icon: '🐱',
            desc: 'Hewan mamalia karnivora berkaki empat yang populer sebagai hewan peliharaan.',
        },
        'dog': {
            label: 'Anjing',
            icon: '🐶',
            desc: 'Hewan mamalia berkaki empat setia yang sering dipelihara atau dijadikan penjaga.',
        },
        'bowl': {
            label: 'Mangkuk',
            icon: '🥣',
            desc: 'Wadah cekung bulat untuk menyajikan makanan berkuah.',
        },
        'banana': {
            label: 'Pisang',
            icon: '🍌',
            desc: 'Buah tropis berkulit kuning kaya akan kalium dan energi.',
        },
        'apple': {
            label: 'Apel',
            icon: '🍎',
            desc: 'Buah bulat berkulit merah/hijau kaya akan serat dan antioksidan.',
        },
    };

    // ==========================================
    // 4. REFERENSI ELEMEN DOM
    // ==========================================
    const elements = {
        stage: null,
        video: null,
        canvas: null,
        ctx: null,
        placeholder: null,
        btnStart: null,
        btnStop: null,
        btnSwitchCamera: null,
        btnSnapshot: null,
        btnAnalyzeAI: null,
        statusBadge: null,
        objectCount: null,
        fpsCounter: null,
        aiPrompt: null,
        aiResultBox: null,
        aiResultText: null,
        aiProviderBadge: null,
        descContainer: null,
        descList: null,
        descCountBadge: null,
        radarToolbar: null,
        btnToggleRadar: null,
        btnToggleSound: null,
        btnToggleAutoAi: null,
        btnLockTarget: null,
        zoomToolbar: null,
        btnZoomReset: null,
        zoomBadge: null,
        persistentCardContainer: null,
    };

    /**
     * Memperbarui tampilan Status Badge di header.
     * @param {'idle'|'loading'|'ready'|'error'} type
     * @param {string} text
     */
    function updateStatus(type, text) {
        if (!elements.statusBadge) return;
        elements.statusBadge.className = `status-badge status-${type}`;
        elements.statusBadge.textContent = text;
    }

    /**
     * Palet warna seragam untuk membedakan kelas objek.
     * @param {string} className
     * @returns {string} Hex Color
     */
    function getColorForClass(className) {
        const colors = [
            '#06b6d4', // Cyan
            '#10b981', // Emerald
            '#f59e0b', // Amber
            '#8b5cf6', // Ungu
            '#ec4899', // Pink
            '#3b82f6', // Biru
            '#f97316', // Oranye
            '#14b8a6', // Teal
        ];
        let hash = 0;
        for (let i = 0; i < className.length; i++) {
            hash = className.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    // ==========================================
    // 5. SISTEM AUDIO & HAPTIC FEEDBACK
    // ==========================================

    /**
     * Inisialisasi AudioContext secara aman pada sentuhan/interaksi pertama.
     */
    function initAudioContext() {
        if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioClass();
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }

    /**
     * Memainkan efek suara radar taktis Web Audio API.
     * @param {'acquire'|'locked'|'ping'|'lost'|'zoom'} type
     */
    function playRadarSound(type) {
        if (!radarConfig.soundEnabled) return;
        try {
            initAudioContext();
            if (!audioContext) return;

            const now = audioContext.currentTime;

            if (type === 'acquire') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(750, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start(now);
                osc.stop(now + 0.04);

            } else if (type === 'locked') {
                [0, 0.07].forEach((delay) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(1350, now + delay);
                    osc.frequency.setValueAtTime(1800, now + delay + 0.02);
                    gain.gain.setValueAtTime(0.10, now + delay);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.05);

                    osc.connect(gain);
                    gain.connect(audioContext.destination);
                    osc.start(now + delay);
                    osc.stop(now + delay + 0.05);
                });

            } else if (type === 'zoom') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(900, now);
                osc.frequency.exponentialRampToValueAtTime(1400, now + 0.05);
                gain.gain.setValueAtTime(0.06, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start(now);
                osc.stop(now + 0.05);

            } else if (type === 'lost') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(450, now);
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
                gain.gain.setValueAtTime(0.03, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start(now);
                osc.stop(now + 0.08);
            }
        } catch (e) {
            // Abaikan kesalahan audio policy
        }
    }

    /**
     * Memicu getaran haptic pada smartphone.
     * @param {'lock'|'tap'} type
     */
    function triggerHaptic(type) {
        if (!radarConfig.hapticEnabled || !navigator.vibrate) return;
        try {
            if (type === 'lock') {
                navigator.vibrate([35, 25, 50]);
            } else if (type === 'tap') {
                navigator.vibrate(25);
            }
        } catch (e) {
            // Abaikan
        }
    }

    // ==========================================
    // 6. PIPELINE & AKSI DIGITAL ZOOM (RoI)
    // ==========================================

    /**
     * Mengatur faktor magnifikasi Digital Zoom dan titik fokus.
     * @param {number} scaleFactor (1.0x - 5.0x)
     * @param {{x: number, y: number}} [focusPoint]
     */
    function setZoom(scaleFactor, focusPoint) {
        const clampedScale = Math.max(zoomViewportState.minScale, Math.min(zoomViewportState.maxScale, scaleFactor));
        zoomViewportState.scale = Number(clampedScale.toFixed(2));
        zoomViewportState.isZooming = zoomViewportState.scale > 1.0;

        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;

        if (focusPoint && typeof focusPoint.x === 'number' && typeof focusPoint.y === 'number') {
            zoomViewportState.centerPoint.x = Math.max(0, Math.min(canvasW, focusPoint.x));
            zoomViewportState.centerPoint.y = Math.max(0, Math.min(canvasH, focusPoint.y));
        } else if (!zoomViewportState.isZooming) {
            zoomViewportState.centerPoint.x = canvasW / 2;
            zoomViewportState.centerPoint.y = canvasH / 2;
        }

        applyVideoZoomTransform();
        updateZoomUI();
        playRadarSound('zoom');
    }

    /**
     * Mereset zoom kembali ke 1.0x (Full Frame).
     */
    function resetZoom() {
        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;
        zoomViewportState.scale = 1.0;
        zoomViewportState.isZooming = false;
        zoomViewportState.centerPoint.x = canvasW / 2;
        zoomViewportState.centerPoint.y = canvasH / 2;

        applyVideoZoomTransform();
        updateZoomUI();
        playRadarSound('zoom');
    }

    /**
     * Memfokuskan dan memperbesar viewport langsung ke target bounding box objek.
     * @param {Array<number>|{x: number, y: number, width: number, height: number}} targetBbox
     */
    function focusOnObject(targetBbox) {
        if (!targetBbox) return;

        let bx, by, bw, bh;
        if (Array.isArray(targetBbox)) {
            [bx, by, bw, bh] = targetBbox;
        } else {
            bx = targetBbox.x;
            by = targetBbox.y;
            bw = targetBbox.width || targetBbox.w || 50;
            bh = targetBbox.height || targetBbox.h || 50;
        }

        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;

        const targetCenterX = bx + bw / 2;
        const targetCenterY = by + bh / 2;

        const scaleByWidth = canvasW / Math.max(40, bw * 2.2);
        const scaleByHeight = canvasH / Math.max(40, bh * 2.2);
        const optimalScale = Math.min(zoomViewportState.maxScale, Math.max(1.8, Math.min(scaleByWidth, scaleByHeight)));

        setZoom(optimalScale, { x: targetCenterX, y: targetCenterY });
    }

    /**
     * Menerapkan transformasi affine pada elemen video agar sinkron dengan proyeksi canvas.
     */
    function applyVideoZoomTransform() {
        if (!elements.video) return;

        const S = zoomViewportState.scale;
        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;

        if (S <= 1.0) {
            elements.video.style.transformOrigin = '';
            elements.video.style.transform = '';
        } else {
            const Cx = zoomViewportState.centerPoint.x;
            const Cy = zoomViewportState.centerPoint.y;

            const txPct = (0.5 - (Cx / canvasW) * S) * 100;
            const tyPct = (0.5 - (Cy / canvasH) * S) * 100;

            elements.video.style.transformOrigin = '0 0';
            elements.video.style.transform = `translate(${txPct.toFixed(3)}%, ${tyPct.toFixed(3)}%) scale(${S})`;
        }
    }

    /**
     * Mentransformasikan koordinat bounding box lokal ke koordinat viewport tampilan sesuai Formula 3.1:
     * X_screen = (bx - Cx) * S + W_viewport / 2
     * Y_screen = (by - Cy) * S + H_viewport / 2
     * W_screen = bw * S
     * H_screen = bh * S
     * @param {number} bx
     * @param {number} by
     * @param {number} bw
     * @param {number} bh
     * @param {number} width
     * @param {number} height
     * @returns {[number, number, number, number]} [xScreen, yScreen, wScreen, hScreen]
     */
    function transformBoxToScreen(bx, by, bw, bh, width, height) {
        const S = zoomViewportState.scale;
        if (S <= 1.0) {
            return [bx, by, bw, bh];
        }

        const Cx = zoomViewportState.centerPoint.x;
        const Cy = zoomViewportState.centerPoint.y;

        const xScreen = (bx - Cx) * S + (width / 2);
        const yScreen = (by - Cy) * S + (height / 2);
        const wScreen = bw * S;
        const hScreen = bh * S;

        return [xScreen, yScreen, wScreen, hScreen];
    }

    /**
     * Memperbarui teks dan status pada tombol zoom toolbar.
     */
    function updateZoomUI() {
        if (elements.zoomBadge) {
            elements.zoomBadge.textContent = `${zoomViewportState.scale.toFixed(1)}x`;
            elements.zoomBadge.style.color = zoomViewportState.scale > 1.0 ? '#38bdf8' : '#94a3b8';
        }

        if (elements.zoomToolbar) {
            const buttons = elements.zoomToolbar.querySelectorAll('.btn-zoom-preset');
            buttons.forEach((btn) => {
                const presetVal = parseFloat(btn.getAttribute('data-zoom') || '1');
                if (Math.abs(presetVal - zoomViewportState.scale) < 0.15) {
                    btn.style.background = '#0284c7';
                    btn.style.color = '#fff';
                } else {
                    btn.style.background = '#1e293b';
                    btn.style.color = '#cbd5e1';
                }
            });
        }
    }

    // ==========================================
    // 7. PERSISTENT DETAIL CARD & AI Q&A INTEGRATION
    // ==========================================

    /**
     * Mengambil freeze-frame crop resolusi tinggi dari video kamera pada area bounding box objek.
     * @param {Object|Array} bbox
     * @returns {string} Data URI Base64 JPEG
     */
    function captureHighResObjectCrop(bbox) {
        if (!elements.video || !stream) {
            return captureSnapshotDataUri() || '';
        }

        const vWidth = elements.video.videoWidth || 640;
        const vHeight = elements.video.videoHeight || 480;
        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;

        let bx, by, bw, bh;
        if (Array.isArray(bbox)) {
            [bx, by, bw, bh] = bbox;
        } else if (bbox) {
            bx = bbox.x;
            by = bbox.y;
            bw = bbox.width || bbox.w;
            bh = bbox.height || bbox.h;
        }

        if (typeof bx !== 'number' || typeof bw !== 'number' || bw <= 0 || bh <= 0) {
            return captureSnapshotDataUri() || '';
        }

        // Skalakan koordinat canvas ke koordinat native video
        const scaleX = vWidth / canvasW;
        const scaleY = vHeight / canvasH;

        // Berikan padding 15% di sekitar objek agar konteks terlihat jelas
        const paddingX = bw * 0.15;
        const paddingY = bh * 0.15;

        const cropX = Math.max(0, Math.round((bx - paddingX) * scaleX));
        const cropY = Math.max(0, Math.round((by - paddingY) * scaleY));
        const cropW = Math.min(vWidth - cropX, Math.round((bw + paddingX * 2) * scaleX));
        const cropH = Math.min(vHeight - cropY, Math.round((bh + paddingY * 2) * scaleY));

        if (cropW <= 10 || cropH <= 10) {
            return captureSnapshotDataUri() || '';
        }

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(elements.video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        return cropCanvas.toDataURL('image/jpeg', 0.90);
    }

    /**
     * Membuka Halaman Detail Objek & AI Q&A System dengan serialisasi konteks lengkap.
     * Sesuai Spesifikasi Bagian 1, 2, dan 5.
     * @param {Object} detectedObjectData
     */
    function openObjectDetailsPage(detectedObjectData) {
        const data = detectedObjectData || persistentUIState.pinnedObjectData;
        if (!data) return;

        // 1. Ambil freeze-frame crop resolusi tinggi dari objek
        const cropB64 = captureHighResObjectCrop(data.bbox);

        // 2. Susun LockedObjectContextPayload (Spesifikasi Bagian 2)
        const contextPayload = {
            objectId: data.id,
            timestamp: Date.now(),
            metadata: {
                label: data.label,
                confidenceScore: data.confidence,
                visualAttributes: { ...(data.description?.attributes || {}) },
                detectedBoundingBox: { ...data.bbox },
                description: { ...(data.description || {}) },
            },
            visualEvidence: {
                highResCropBase64: cropB64,
                mimeType: 'image/jpeg',
            },
            environmentalContext: {
                zoomScale: zoomViewportState.scale,
                facingMode: currentFacingMode,
                centerPoint: { ...zoomViewportState.centerPoint },
            },
        };

        // 3. Simpan ke sessionStorage (Spesifikasi Bagian 5 & 6)
        try {
            sessionStorage.setItem('suco_object_context_' + data.id, JSON.stringify(contextPayload));
            sessionStorage.setItem('suco_current_context', JSON.stringify(contextPayload));
            sessionStorage.setItem('suco_camera_restore_state', JSON.stringify({
                scale: zoomViewportState.scale,
                centerPoint: { ...zoomViewportState.centerPoint },
                facingMode: currentFacingMode,
                pinnedObjectId: data.id,
            }));
        } catch (e) {
            console.warn('[Suco+] Gagal menyimpan context ke sessionStorage:', e);
        }

        // 4. Navigasikan ke /objects/:objectId/details (Spesifikasi Bagian 1.2)
        const basePath = (window.BASE_PATH || '').replace(/\/+$/, '');
        const targetUrl = (basePath ? basePath : '') + '/objects/' + encodeURIComponent(data.id) + '/details';
        window.location.href = targetUrl;
    }

    /**
     * Mengunci objek terpilih dan membuka kartu deskripsi persisten.
     * Tidak akan hilang oleh occlusions atau perpindahan frame.
     * @param {Object} object
     */
    function pinObject(object) {
        if (!object) return;

        const info = OBJECT_DESCRIPTIONS[object.class] || { label: object.class, icon: '🎯', desc: '' };
        const scorePct = Math.round((object.score || 0.85) * 100);

        const detectedObjectData = {
            id: object.id || `TGT-${String(nextTargetCounter++).padStart(2, '0')}`,
            label: info.label,
            class: object.class,
            confidence: object.score || 0.85,
            bbox: {
                x: Array.isArray(object.bbox) ? object.bbox[0] : (object.bbox?.x || 0),
                y: Array.isArray(object.bbox) ? object.bbox[1] : (object.bbox?.y || 0),
                width: Array.isArray(object.bbox) ? object.bbox[2] : (object.bbox?.width || 50),
                height: Array.isArray(object.bbox) ? object.bbox[3] : (object.bbox?.height || 50),
            },
            description: {
                title: `${info.icon} ${info.label}`,
                summary: info.desc || `Objek teridentifikasi sebagai ${object.class} dengan akurasi ${scorePct}%.`,
                attributes: {
                    'Status': 'Aktif di Radar',
                    'Akurasi': `${scorePct}%`,
                    'Jarak Estimasi': (1.5 / Math.max(0.06, (object.bbox?.[3] || 100) / 480)).toFixed(1) + ' meter',
                    'Target ID': object.id || 'TGT-PINNED',
                    'Terdaftar': new Date().toLocaleTimeString(),
                },
                timestamp: Date.now(),
            },
        };

        persistentUIState.pinnedObjectId = detectedObjectData.id;
        persistentUIState.pinnedObjectData = detectedObjectData;
        persistentUIState.isDetailVisible = true;

        userPinnedTargetId = detectedObjectData.id;
        priorityTargetId = detectedObjectData.id;

        triggerHaptic('tap');
        playRadarSound('locked');
        renderPersistentDetailCard();
    }

    /**
     * SATU-SATUNYA cara menutup deskripsi objek: manual trigger oleh user (Tombol Tutup / X).
     */
    function dismissPinnedObject() {
        persistentUIState.isDetailVisible = false;
        persistentUIState.pinnedObjectId = null;
        persistentUIState.pinnedObjectData = null;
        userPinnedTargetId = null;

        renderPersistentDetailCard();
    }

    /**
     * Memperbarui atribut deskripsi tanpa menutup kartu jika objek masih terdeteksi.
     * @param {Object} updatedData
     */
    function updatePinnedMetadata(updatedData) {
        if (!persistentUIState.isDetailVisible || !persistentUIState.pinnedObjectData) return;

        Object.assign(persistentUIState.pinnedObjectData.description, updatedData);
        renderPersistentDetailCard();
    }

    /**
     * Merender komponen kartu deskripsi persisten secara terpisah dari detection loop.
     */
    function renderPersistentDetailCard() {
        if (!elements.persistentCardContainer) return;

        if (!persistentUIState.isDetailVisible || !persistentUIState.pinnedObjectData) {
            elements.persistentCardContainer.innerHTML = '';
            elements.persistentCardContainer.style.display = 'none';
            return;
        }

        const data = persistentUIState.pinnedObjectData;
        const isCurrentlyTracked = activeTracks.has(data.id);
        const statusColor = isCurrentlyTracked ? '#10b981' : '#f59e0b';
        const statusText = isCurrentlyTracked ? '● AKTIF DI RADAR' : '○ TERSIMPAN DI MEMORI (DI LUAR FRAME)';

        let attrHtml = '';
        if (data.description.attributes) {
            Object.entries(data.description.attributes).forEach(([key, val]) => {
                attrHtml += `
                    <div style="background: rgba(30, 41, 59, 0.7); padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid #334155;">
                        <span style="color: #94a3b8; font-size: 0.72rem; display: block;">${key}</span>
                        <strong style="color: #f1f5f9; font-size: 0.8rem;">${val}</strong>
                    </div>
                `;
            });
        }

        elements.persistentCardContainer.style.display = 'block';
        elements.persistentCardContainer.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.95); border: 2px solid #0284c7; border-left: 6px solid #0284c7; border-radius: 12px; padding: 1.1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(8px); position: relative;">
                <!-- Header Kartu & Tombol Tutup Manual -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span style="font-size: 1.25rem;">${data.description.title.split(' ')[0]}</span>
                            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: #f8fafc;">
                                ${data.label} <span style="font-size: 0.8rem; color: #38bdf8; font-family: monospace;">[${data.id}]</span>
                            </h3>
                            <span style="font-size: 0.72rem; font-weight: 700; color: ${statusColor}; background: rgba(0,0,0,0.3); border: 1px solid ${statusColor}; padding: 0.15rem 0.5rem; border-radius: 999px;">
                                ${statusText}
                            </span>
                        </div>
                    </div>

                    <!-- SATU-SATUNYA TOMBOL UNTUK MENUTUP KARTU -->
                    <button 
                        id="btnDismissPinnedObject" 
                        type="button" 
                        aria-label="Tutup Deskripsi"
                        style="background: #ef4444; color: #fff; border: none; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.8rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;"
                        title="Tutup kartu deskripsi persisten"
                    >
                        <span>✕</span> Tutup
                    </button>
                </div>

                <!-- Deskripsi Lengkap -->
                <p style="color: #cbd5e1; font-size: 0.9rem; line-height: 1.5; margin: 0 0 0.75rem 0;">
                    ${data.description.summary}
                </p>

                <!-- Grid Atribut Telemetri -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.4rem; margin-bottom: 0.85rem;">
                    ${attrHtml}
                </div>

                <!-- Aksi Utama: Buka Halaman Detail & Tanya AI, Zoom ke Objek & Analisis AI -->
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; border-top: 1px solid #334155; padding-top: 0.75rem; align-items: center;">
                    <button 
                        id="btnOpenDetailsPage" 
                        type="button" 
                        style="background: linear-gradient(135deg, #0284c7, #0d9488); color: #fff; border: none; padding: 0.45rem 1rem; border-radius: 6px; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.4rem; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);"
                        title="Buka halaman detail visual dan percakapan interaktif AI"
                    >
                        💬 Buka Halaman Detail & Tanya AI
                    </button>
                    <button 
                        id="btnZoomToObject" 
                        type="button" 
                        style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;"
                    >
                        🔍 Zoom ke Objek
                    </button>
                    <button 
                        id="btnAiAnalyzeObject" 
                        type="button" 
                        style="background: #8b5cf6; color: #fff; border: none; padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;"
                    >
                        🤖 Quick AI
                    </button>
                </div>
            </div>
        `;

        // Event Listener Tombol Buka Halaman Detail & Tanya AI
        const btnOpenDetails = document.getElementById('btnOpenDetailsPage');
        if (btnOpenDetails) {
            btnOpenDetails.addEventListener('click', (e) => {
                e.stopPropagation();
                openObjectDetailsPage(data);
            });
        }

        // Event Listener Manual Tutup
        const btnDismiss = document.getElementById('btnDismissPinnedObject');
        if (btnDismiss) {
            btnDismiss.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissPinnedObject();
            });
        }

        // Event Listener Zoom ke Objek
        const btnZoomTo = document.getElementById('btnZoomToObject');
        if (btnZoomTo) {
            btnZoomTo.addEventListener('click', (e) => {
                e.stopPropagation();
                focusOnObject(data.bbox);
            });
        }

        // Event Listener Quick AI
        const btnAi = document.getElementById('btnAiAnalyzeObject');
        if (btnAi) {
            btnAi.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elements.aiPrompt) {
                    elements.aiPrompt.value = `Analisis mendalam objek ${data.label} (${data.id}, ${Math.round(data.confidence * 100)}%). Jelaskan fungsi teknis, keamanan, dan rekomendasi terkait objek ini.`;
                }
                handleAnalyzeAI();
            });
        }
    }

    // ==========================================
    // 8. INISIALISASI & AKSES KAMERA
    // ==========================================

    /**
     * Inisialisasi Akselerasi GPU WebGL pada TensorFlow.js
     */
    async function initGpuAcceleration() {
        if (typeof window.tf !== 'undefined') {
            try {
                await window.tf.setBackend('webgl');
                if (window.tf.env) {
                    window.tf.env().set('WEBGL_CPU_FORWARD', false);
                    window.tf.env().set('WEBGL_PACK', true);
                    window.tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
                }
                await window.tf.ready();
                console.log('[Suco+] GPU Backend aktif (WebGL Ultra):', window.tf.getBackend());
            } catch (gpuErr) {
                console.warn('[Suco+] WebGL fallback:', gpuErr);
            }
        }
    }

    /**
     * Memuat Model TensorFlow.js COCO-SSD secara asynchronous (Promise Singleton).
     * @returns {Promise<boolean>}
     */
    async function loadModel() {
        if (model) return true;
        if (modelPromise) return modelPromise;

        if (typeof window.cocoSsd === 'undefined') {
            updateStatus('error', 'Library AI belum termuat');
            return false;
        }

        updateStatus('loading', 'Memuat model AI...');

        modelPromise = (async () => {
            try {
                await initGpuAcceleration();
                model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
                updateStatus('ready', isDetecting ? 'Multi-Target Radar Aktif' : 'Model Siap');
                return true;
            } catch (err) {
                console.error('[Suco+] Gagal memuat COCO-SSD:', err);
                updateStatus('error', 'Gagal memuat model AI');
                modelPromise = null;
                return false;
            }
        })();

        return modelPromise;
    }

    /**
     * Memperbarui ukuran kanvas inferensi agar sebanding dengan rasio video asli.
     * @param {number} vWidth
     * @param {number} vHeight
     */
    function updateInferDimensions(vWidth, vHeight) {
        if (!vWidth || !vHeight) return;

        maxInferDimension = (typeof window !== 'undefined' && window.innerWidth < 640) ? 300 : 360;

        if (vWidth >= vHeight) {
            inferWidth = maxInferDimension;
            inferHeight = Math.max(1, Math.round((vHeight / vWidth) * maxInferDimension));
        } else {
            inferHeight = maxInferDimension;
            inferWidth = Math.max(1, Math.round((vWidth / vHeight) * maxInferDimension));
        }

        if (inferCanvas) {
            if (inferCanvas.width !== inferWidth || inferCanvas.height !== inferHeight) {
                inferCanvas.width = inferWidth;
                inferCanvas.height = inferHeight;
            }
        }
    }

    /**
     * Memulai aliran video kamera dengan constraint responsif.
     */
    async function startCamera() {
        if (stream) return;

        initAudioContext();

        if (!inferCanvas) {
            inferCanvas = document.createElement('canvas');
            inferCanvas.width = inferWidth;
            inferCanvas.height = inferHeight;
            inferCtx = inferCanvas.getContext('2d', { willReadFrequently: true });
        }

        if (!model && !modelPromise) {
            loadModel();
        }

        const cameraLabel = currentFacingMode === 'environment' ? 'belakang' : 'depan';
        updateStatus('loading', `Menghubungkan kamera ${cameraLabel}...`);

        try {
            const constraints = {
                audio: false,
                video: {
                    facingMode: { ideal: currentFacingMode },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            elements.video.srcObject = stream;

            await new Promise((resolve) => {
                elements.video.onloadedmetadata = () => {
                    elements.video.play().then(resolve);
                };
            });

            syncCanvasDimensions();

            // Terapkan zoom yang tersimpan jika ada pemulihan sesi
            if (zoomViewportState.scale > 1.0) {
                applyVideoZoomTransform();
                updateZoomUI();
            }

            if (elements.placeholder) {
                elements.placeholder.classList.add('hidden');
            }

            if (elements.btnStart) elements.btnStart.disabled = true;
            if (elements.btnStop) elements.btnStop.disabled = false;
            if (elements.btnSwitchCamera) elements.btnSwitchCamera.disabled = false;
            if (elements.btnSnapshot) elements.btnSnapshot.disabled = false;
            if (elements.btnAnalyzeAI) elements.btnAnalyzeAI.disabled = false;
            if (elements.btnLockTarget) elements.btnLockTarget.disabled = false;

            updateStatus(model ? 'ready' : 'loading', model ? `Multi-Target Radar Aktif (${cameraLabel.toUpperCase()})` : 'Kamera Aktif (Menyiapkan AI...)');

            isDetecting = true;
            lastRenderTime = performance.now();
            lastFpsUpdate = performance.now();
            frameCount = 0;

            renderLoop();
            triggerInference();

        } catch (err) {
            console.error('[Suco+] Gagal mengakses kamera:', err);
            updateStatus('error', 'Akses kamera ditolak / tidak ditemukan');

            let userMsg = 'Tidak dapat mengakses kamera.';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                userMsg = 'Izin kamera ditolak. Mohon izinkan akses kamera di setelan browser.';
            } else if (err.name === 'OverconstrainedError') {
                currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
                return startCamera();
            }

            alert(userMsg);
            stopCamera();
        }
    }

    /**
     * Mengalihkan kamera (Depan / Belakang).
     */
    async function switchCamera() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

        if (stream) {
            isDetecting = false;
            isInferring = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            stream.getTracks().forEach((track) => track.stop());
            stream = null;

            if (elements.video) {
                elements.video.srcObject = null;
            }

            if (elements.ctx && elements.canvas) {
                elements.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
            }

            resetMultiRadarState();
            await startCamera();
        } else {
            const label = currentFacingMode === 'environment' ? 'Belakang' : 'Depan';
            updateStatus(model ? 'ready' : 'idle', `Kamera berikutnya: ${label}`);
        }
    }

    /**
     * Menghentikan kamera dan membersihkan resource.
     */
    function stopCamera() {
        isDetecting = false;
        isInferring = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }

        if (elements.video) {
            elements.video.srcObject = null;
        }

        if (elements.ctx && elements.canvas) {
            elements.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
        }

        if (elements.placeholder) {
            elements.placeholder.classList.remove('hidden');
        }

        if (elements.btnStart) elements.btnStart.disabled = false;
        if (elements.btnStop) elements.btnStop.disabled = true;
        if (elements.btnSnapshot) elements.btnSnapshot.disabled = true;
        if (elements.btnAnalyzeAI) elements.btnAnalyzeAI.disabled = true;
        if (elements.btnLockTarget) elements.btnLockTarget.disabled = true;

        if (elements.objectCount) elements.objectCount.textContent = '0';
        if (elements.fpsCounter) elements.fpsCounter.textContent = '0';

        latestDetections = [];
        resetMultiRadarState();
        resetZoom();
        renderObjectDescriptions();
        updateStatus(model ? 'ready' : 'idle', model ? 'Model Siap (Kamera Berhenti)' : 'Model belum dimuat');
    }

    /**
     * Menyesuaikan ukuran canvas buffer secara tepat.
     */
    function syncCanvasDimensions() {
        if (!elements.video || !elements.canvas) return;
        const vWidth = elements.video.videoWidth || 640;
        const vHeight = elements.video.videoHeight || 480;

        if (elements.canvas.width !== vWidth || elements.canvas.height !== vHeight) {
            elements.canvas.width = vWidth;
            elements.canvas.height = vHeight;
        }

        updateInferDimensions(vWidth, vHeight);

        if (elements.stage && vWidth > 0 && vHeight > 0) {
            elements.stage.style.aspectRatio = `${vWidth} / ${vHeight}`;
        }
    }

    // ==========================================
    // 9. ENGINE MULTI-TARGET TRACKING (MTT) RADAR
    // ==========================================

    /**
     * Mereset seluruh jejak multi-target radar.
     */
    function resetMultiRadarState() {
        activeTracks.clear();
        nextTargetCounter = 1;
        priorityTargetId = null;
        userPinnedTargetId = null;
        lastPriorityAnnouncedId = null;
    }

    /**
     * Menghitung nilai IoU (Intersection over Union).
     */
    function calculateIoU(boxA, boxB) {
        const xA = Math.max(boxA[0], boxB[0]);
        const yA = Math.max(boxA[1], boxB[1]);
        const xB = Math.min(boxA[0] + boxA[2], boxB[0] + boxB[2]);
        const yB = Math.min(boxA[1] + boxA[3], boxB[1] + boxB[3]);

        const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
        const boxAArea = boxA[2] * boxA[3];
        const boxBArea = boxB[2] * boxB[3];
        const unionArea = boxAArea + boxBArea - interArea;

        return unionArea > 0 ? interArea / unionArea : 0;
    }

    /**
     * Mengupdate Multi-Target Tracking dengan pencocokan asosiasi deteksi baru ke jejak lama.
     * @param {Array<Object>} detections
     */
    function updateMultiTargetTracks(detections) {
        const now = performance.now();
        const canvasW = elements.canvas ? elements.canvas.width : 640;
        const canvasH = elements.canvas ? elements.canvas.height : 480;
        const centerX = canvasW / 2;
        const centerY = canvasH / 2;
        const maxDist = Math.hypot(centerX, centerY);

        const matchedTrackKeys = new Set();
        const matchedDetections = new Set();

        // 1. Asosiasi Jejak Lama ke Deteksi Baru (Berdasarkan IoU & Kelas Objek)
        activeTracks.forEach((track, trackId) => {
            let bestIoU = 0.20;
            let bestDetIdx = -1;

            for (let i = 0; i < detections.length; i++) {
                if (matchedDetections.has(i)) continue;
                const det = detections[i];
                if (det.class === track.class) {
                    const iou = calculateIoU(track.bbox, det.bbox);
                    if (iou > bestIoU) {
                        bestIoU = iou;
                        bestDetIdx = i;
                    }
                }
            }

            if (bestDetIdx !== -1) {
                const det = detections[bestDetIdx];
                matchedDetections.add(bestDetIdx);
                matchedTrackKeys.add(trackId);

                track.bbox = [...det.bbox];
                track.score = det.score;
                track.lastSeen = now;

                const smooth = 0.50;
                track.reticle.x += (det.bbox[0] - track.reticle.x) * smooth;
                track.reticle.y += (det.bbox[1] - track.reticle.y) * smooth;
                track.reticle.w += (det.bbox[2] - track.reticle.w) * smooth;
                track.reticle.h += (det.bbox[3] - track.reticle.h) * smooth;

                const elapsed = now - track.firstSeen;
                track.lockProgress = Math.min(1.0, elapsed / radarConfig.lockHoldThresholdMs);
                track.isLocked = track.lockProgress >= 1.0;

                // Sync in-place jika objek ini sedang dibuka pada Persistent Card
                if (persistentUIState.isDetailVisible && persistentUIState.pinnedObjectId === trackId) {
                    persistentUIState.pinnedObjectData.confidence = det.score;
                    persistentUIState.pinnedObjectData.bbox = {
                        x: det.bbox[0],
                        y: det.bbox[1],
                        width: det.bbox[2],
                        height: det.bbox[3],
                    };
                    persistentUIState.pinnedObjectData.description.attributes['Akurasi'] = `${Math.round(det.score * 100)}%`;
                    persistentUIState.pinnedObjectData.description.attributes['Status'] = 'Aktif di Radar';
                }
            }
        });

        // 2. Buat Jejak Baru untuk Deteksi yang Belum Terasosiasi
        for (let i = 0; i < detections.length; i++) {
            if (matchedDetections.has(i)) continue;
            const det = detections[i];

            const idNumber = String(nextTargetCounter++).padStart(2, '0');
            const newTrackId = `TGT-${idNumber}`;

            activeTracks.set(newTrackId, {
                id: newTrackId,
                class: det.class,
                score: det.score,
                bbox: [...det.bbox],
                reticle: {
                    x: det.bbox[0],
                    y: det.bbox[1],
                    w: det.bbox[2],
                    h: det.bbox[3],
                },
                firstSeen: now,
                lastSeen: now,
                lockProgress: 0.15,
                isLocked: false,
                isPriority: false,
            });

            matchedTrackKeys.add(newTrackId);
            playRadarSound('acquire');
        }

        // 3. Bersihkan Jejak yang Hilang melebihi grace period
        activeTracks.forEach((track, trackId) => {
            if (now - track.lastSeen > radarConfig.maxTrackMemoryMs) {
                if (trackId === priorityTargetId) {
                    playRadarSound('lost');
                    priorityTargetId = null;
                }
                activeTracks.delete(trackId);

                if (persistentUIState.isDetailVisible && persistentUIState.pinnedObjectId === trackId) {
                    persistentUIState.pinnedObjectData.description.attributes['Status'] = 'Tersimpan di Memori (Di Luar Frame)';
                    renderPersistentDetailCard();
                }
            }
        });

        // 4. Penentuan TARGET PRIORITAS
        if (userPinnedTargetId && activeTracks.has(userPinnedTargetId)) {
            priorityTargetId = userPinnedTargetId;
        } else {
            let highestPriorityScore = -Infinity;
            let candidateId = null;

            activeTracks.forEach((track, trackId) => {
                const [bx, by, bw, bh] = track.bbox;
                const objCenterX = bx + bw / 2;
                const objCenterY = by + bh / 2;
                const distToCenter = Math.hypot(objCenterX - centerX, objCenterY - centerY);
                const distRatio = Math.min(1.0, distToCenter / maxDist);

                const priorityScore = ((1.0 - distRatio) * 0.65) + (track.score * 0.35);

                if (priorityScore > highestPriorityScore) {
                    highestPriorityScore = priorityScore;
                    candidateId = trackId;
                }
            });

            priorityTargetId = candidateId;
        }

        // 5. Tandai Target Prioritas & Picu Event Saat Berhasil Dikunci 100%
        activeTracks.forEach((track, trackId) => {
            track.isPriority = (trackId === priorityTargetId);
            if (track.isPriority && track.isLocked) {
                if (lastPriorityAnnouncedId !== trackId) {
                    lastPriorityAnnouncedId = trackId;
                    playRadarSound('locked');
                    triggerHaptic('lock');
                    onPriorityTargetLocked(track);
                }
            }
        });
    }

    /**
     * Dipanggil saat Target Prioritas terkunci 100%.
     * @param {Object} priorityTrack
     */
    function onPriorityTargetLocked(priorityTrack) {
        if (!elements.aiPrompt) return;

        const info = OBJECT_DESCRIPTIONS[priorityTrack.class] || { label: priorityTrack.class };
        const scorePct = Math.round(priorityTrack.score * 100);

        const otherTargets = [];
        activeTracks.forEach((tr) => {
            if (tr.id !== priorityTrack.id) {
                const trInfo = OBJECT_DESCRIPTIONS[tr.class] || { label: tr.class };
                otherTargets.push(`${tr.id} [${trInfo.label} (${Math.round(tr.score * 100)}%)]`);
            }
        });

        const multiSummary = otherTargets.length > 0
            ? ` Objek sekunder lain di radar: ${otherTargets.join(', ')}.`
            : '';

        elements.aiPrompt.value = `Target Prioritas ${priorityTrack.id} [${info.label} (${scorePct}%)] terkunci di radar.${multiSummary} Berikan analisis hubungan antar objek, fungsi spesifik, dan rekomendasi praktis.`;

        if (radarConfig.autoAiOnLock) {
            const now = performance.now();
            if (now - lastAutoAiTrigger > radarConfig.autoAiCooldownMs) {
                lastAutoAiTrigger = now;
                console.log(`[Suco+ Radar] Auto AI memicu analisis multi-objek.`);
                handleAnalyzeAI();
            }
        }
    }

    // ==========================================
    // 10. RENDERING MULTI-OBJECT RADAR HUD (60 FPS)
    // ==========================================

    /**
     * Merender seluruh elemen visual Radar HUD Militer & Multi-Target Reticles.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} width
     * @param {number} height
     */
    function drawMultiTargetRadarHud(ctx, width, height) {
        const cx = width / 2;
        const cy = height / 2;
        const totalTracks = activeTracks.size;

        sweepAngle = (sweepAngle + 2.5) % 360;

        ctx.save();

        // 1. Header Telemetri Multi-Target Radar (Kiri Atas)
        ctx.font = 'bold 11px "Courier New", monospace, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = totalTracks > 0 ? '#38bdf8' : '#64748b';

        ctx.fillText(`SYS: MTT MULTI-RADAR v3.2 [RoI ZOOM]`, 14, 12);

        const priorityTrack = priorityTargetId ? activeTracks.get(priorityTargetId) : null;
        if (priorityTrack) {
            const pInfo = OBJECT_DESCRIPTIONS[priorityTrack.class] || { label: priorityTrack.class };
            ctx.fillStyle = priorityTrack.isLocked ? '#10b981' : '#f59e0b';
            ctx.fillText(
                `TRACKING: ${totalTracks} TARGETS | PRIORITY: ${priorityTrack.id} (${pInfo.label.toUpperCase()})`,
                14,
                26
            );
        } else {
            ctx.fillStyle = '#64748b';
            ctx.fillText(`TRACKING: SCANNING FIELD (0 TARGETS)`, 14, 26);
        }

        // 2. Telemetri Kanan Atas (Bearing, Zoom & Status)
        ctx.textAlign = 'right';
        ctx.fillStyle = '#06b6d4';
        const zoomText = zoomViewportState.scale > 1.0 ? ` | ZOOM: ${zoomViewportState.scale.toFixed(1)}x` : '';
        ctx.fillText(`BEARING: ${Math.round(sweepAngle).toString().padStart(3, '0')}°${zoomText}`, width - 14, 12);
        if (priorityTrack) {
            ctx.fillStyle = priorityTrack.isLocked ? '#10b981' : '#f59e0b';
            ctx.fillText(`PRIORITY LOCK: ${Math.round(priorityTrack.lockProgress * 100)}%`, width - 14, 26);
        } else {
            ctx.fillText(`STATUS: SEARCHING`, width - 14, 26);
        }
        ctx.textAlign = 'left';

        // 3. Lingkaran Konsentris Radar Tengah & Indikator Jarak
        const ringDistances = [
            { r: 50, label: '1m' },
            { r: 110, label: '2m' },
            { r: 180, label: '3m' },
        ];

        ctx.strokeStyle = 'rgba(6, 182, 212, 0.28)';
        ctx.lineWidth = 1;
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(6, 182, 212, 0.5)';

        ringDistances.forEach((ring) => {
            ctx.beginPath();
            ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillText(ring.label, cx + 4, cy - ring.r + 11);
        });

        // 4. Garis Reticle Silang Pusat
        const gap = 16;
        const len = 34;
        ctx.beginPath();
        ctx.moveTo(cx - gap - len, cy);
        ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy);
        ctx.lineTo(cx + gap + len, cy);
        ctx.moveTo(cx, cy - gap - len);
        ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap);
        ctx.lineTo(cx, cy + gap + len);
        ctx.stroke();

        // 5. Garis Sapuan Radar Pemindai (360° Sweep Line)
        const rad = (sweepAngle * Math.PI) / 180;
        const sweepLen = 180;
        const sx = cx + Math.cos(rad) * sweepLen;
        const sy = cy + Math.sin(rad) * sweepLen;
        const sweepGrad = ctx.createLinearGradient(cx, cy, sx, sy);
        sweepGrad.addColorStop(0, 'rgba(6, 182, 212, 0.65)');
        sweepGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
        ctx.strokeStyle = sweepGrad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        // 6. Garis Vektor Penghubung ke Seluruh Target (Ditransformasikan ke Viewport)
        activeTracks.forEach((track) => {
            const [sxBox, syBox, swBox, shBox] = transformBoxToScreen(
                track.reticle.x,
                track.reticle.y,
                track.reticle.w,
                track.reticle.h,
                width,
                height
            );

            const tx = sxBox + swBox / 2;
            const ty = syBox + shBox / 2;

            ctx.save();
            if (track.isPriority) {
                ctx.strokeStyle = track.isLocked ? 'rgba(16, 185, 129, 0.5)' : 'rgba(245, 158, 11, 0.5)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
            } else {
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.22)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 5]);
            }
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.restore();
        });

        // 7. Render Setiap Target Reticle Individual dengan Transformasi Formula 3.1
        activeTracks.forEach((track) => {
            drawIndividualTargetReticle(ctx, track, width, height);
        });

        ctx.restore();
    }

    /**
     * Menggambar Reticle Target untuk Satu Objek (Prioritas atau Sekunder) pada Koordinat Viewport.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} track
     * @param {number} width
     * @param {number} height
     */
    function drawIndividualTargetReticle(ctx, track, width, height) {
        const [rx, ry, rw, rh] = transformBoxToScreen(
            track.reticle.x,
            track.reticle.y,
            track.reticle.w,
            track.reticle.h,
            width,
            height
        );

        if (rw <= 0 || rh <= 0) return;
        if (rx + rw < -50 || rx > width + 50 || ry + rh < -50 || ry > height + 50) return;

        const isPriority = track.isPriority;
        const isLocked = track.isLocked;

        let mainColor = '#06b6d4';
        if (isPriority) {
            mainColor = isLocked ? '#10b981' : '#f59e0b';
        }

        const info = OBJECT_DESCRIPTIONS[track.class] || { label: track.class, icon: '🎯' };
        const scorePct = Math.round(track.score * 100);

        const heightRatio = Math.max(0.06, track.reticle.h / height);
        const estDistance = (1.5 / heightRatio).toFixed(1);

        ctx.save();
        ctx.strokeStyle = mainColor;
        ctx.shadowColor = mainColor;
        ctx.shadowBlur = isPriority ? (isLocked ? 10 : 6) : 3;
        ctx.lineWidth = isPriority ? 2.6 : 1.8;

        const cornerSize = Math.max(12, Math.min(rw, rh) * 0.22);

        // Sudut Kiri Atas
        ctx.beginPath();
        ctx.moveTo(rx, ry + cornerSize);
        ctx.lineTo(rx, ry);
        ctx.lineTo(rx + cornerSize, ry);
        ctx.stroke();

        // Sudut Kanan Atas
        ctx.beginPath();
        ctx.moveTo(rx + rw - cornerSize, ry);
        ctx.lineTo(rx + rw, ry);
        ctx.lineTo(rx + rw, ry + cornerSize);
        ctx.stroke();

        // Sudut Kanan Bawah
        ctx.beginPath();
        ctx.moveTo(rx + rw, ry + rh - cornerSize);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.lineTo(rx + rw - cornerSize, ry + rh);
        ctx.stroke();

        // Sudut Kiri Bawah
        ctx.beginPath();
        ctx.moveTo(rx + cornerSize, ry + rh);
        ctx.lineTo(rx, ry + rh);
        ctx.lineTo(rx, ry + rh - cornerSize);
        ctx.stroke();

        // Titik Tengah Target '+' dan Busur Kemajuan Kunci
        const targetCenterX = rx + rw / 2;
        const targetCenterY = ry + rh / 2;
        const ringRadius = Math.max(18, Math.min(rw, rh) * 0.32);

        ctx.beginPath();
        ctx.moveTo(targetCenterX - 6, targetCenterY);
        ctx.lineTo(targetCenterX + 6, targetCenterY);
        ctx.moveTo(targetCenterX, targetCenterY - 6);
        ctx.lineTo(targetCenterX, targetCenterY + 6);
        ctx.stroke();

        ctx.lineWidth = isPriority ? 2.8 : 1.8;
        ctx.beginPath();
        const startArc = -Math.PI / 2;
        const endArc = startArc + (Math.PI * 2 * track.lockProgress);
        ctx.arc(targetCenterX, targetCenterY, ringRadius, startArc, endArc);
        ctx.stroke();

        const isPinned = (persistentUIState.pinnedObjectId === track.id);
        const pinTag = isPinned ? ' 📌[PINNED]' : '';
        const prefix = isPriority ? (isLocked ? '🔒 [PRIORITY LOCK]' : '🎯 [ACQUIRING]') : `🛰️ [${track.id}]`;
        const tagText = `${prefix}${pinTag} ${info.label.toUpperCase()} ${scorePct}%`;
        const subText = `ID: ${track.id} | RNG: ~${estDistance}m | LCK: ${Math.round(track.lockProgress * 100)}%`;

        ctx.font = 'bold 11px "Courier New", monospace, sans-serif';
        const tagWidth = Math.max(ctx.measureText(tagText).width, ctx.measureText(subText).width) + 14;
        const tagHeight = 34;

        let tagX = rx;
        let tagY = (ry - tagHeight - 5 >= 4) ? (ry - tagHeight - 5) : (ry + rh + 5);
        if (tagX + tagWidth > width - 4) tagX = width - tagWidth - 4;
        if (tagX < 4) tagX = 4;

        ctx.fillStyle = isPriority
            ? (isLocked ? 'rgba(6, 78, 59, 0.90)' : 'rgba(120, 53, 15, 0.90)')
            : 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(tagX, tagY, tagWidth, tagHeight);

        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(tagX, tagY, tagWidth, tagHeight);

        ctx.fillStyle = isPriority ? (isLocked ? '#a7f3d0' : '#fde68a') : '#e0f2fe';
        ctx.textBaseline = 'top';
        ctx.fillText(tagText, tagX + 6, tagY + 4);

        ctx.fillStyle = isPriority ? (isLocked ? '#6ee7b7' : '#fcd34d') : '#94a3b8';
        ctx.font = '10px "Courier New", monospace, sans-serif';
        ctx.fillText(subText, tagX + 6, tagY + 18);

        ctx.restore();
    }

    // ==========================================
    // 11. LOOP RENDERING & INFERENSI ZERO-DELAY
    // ==========================================

    /**
     * Loop Rendering Cepat (60 FPS) terpisah dari inferensi AI.
     */
    function renderLoop() {
        if (!isDetecting || !elements.video) return;

        if (elements.video.readyState >= 2 && !elements.video.paused && !elements.video.ended) {
            syncCanvasDimensions();

            if (elements.ctx) {
                elements.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

                if (radarConfig.enabled) {
                    drawMultiTargetRadarHud(elements.ctx, elements.canvas.width, elements.canvas.height);
                }
            }

            calculateFps();
        }

        if (isDetecting) {
            animationFrameId = requestAnimationFrame(renderLoop);
        }
    }

    /**
     * Loop Inferensi Cepat Non-Blocking dengan Dukungan Sub-Frame RoI Cropping saat Zoom Aktif.
     */
    async function triggerInference() {
        if (!isDetecting) return;

        if (model && elements.video && elements.video.readyState >= 2 && !isInferring) {
            isInferring = true;

            try {
                const vWidth = elements.video.videoWidth || 640;
                const vHeight = elements.video.videoHeight || 480;
                updateInferDimensions(vWidth, vHeight);

                const S = zoomViewportState.scale;
                let rawPredictions = [];

                if (S > 1.0) {
                    const canvasW = elements.canvas ? elements.canvas.width : 640;
                    const canvasH = elements.canvas ? elements.canvas.height : 480;
                    const CxNorm = zoomViewportState.centerPoint.x / canvasW;
                    const CyNorm = zoomViewportState.centerPoint.y / canvasH;

                    const cropW = vWidth / S;
                    const cropH = vHeight / S;
                    const cropX = Math.max(0, Math.min(vWidth - cropW, (CxNorm * vWidth) - (cropW / 2)));
                    const cropY = Math.max(0, Math.min(vHeight - cropH, (CyNorm * vHeight) - (cropH / 2)));

                    inferCtx.drawImage(elements.video, cropX, cropY, cropW, cropH, 0, 0, inferWidth, inferHeight);
                    const subPredictions = await model.detect(inferCanvas, MAX_DETECTIONS, MIN_CONFIDENCE_SCORE);

                    const scaleBackX = cropW / inferWidth;
                    const scaleBackY = cropH / inferHeight;

                    rawPredictions = subPredictions.map((p) => ({
                        class: p.class,
                        score: p.score,
                        bbox: [
                            cropX + (p.bbox[0] * scaleBackX),
                            cropY + (p.bbox[1] * scaleBackY),
                            p.bbox[2] * scaleBackX,
                            p.bbox[3] * scaleBackY,
                        ],
                    }));

                } else {
                    inferCtx.drawImage(elements.video, 0, 0, inferWidth, inferHeight);
                    const normalPreds = await model.detect(inferCanvas, MAX_DETECTIONS, MIN_CONFIDENCE_SCORE);

                    const scaleNormX = vWidth / inferWidth;
                    const scaleNormY = vHeight / inferHeight;

                    rawPredictions = normalPreds.map((p) => ({
                        class: p.class,
                        score: p.score,
                        bbox: [
                            p.bbox[0] * scaleNormX,
                            p.bbox[1] * scaleNormY,
                            p.bbox[2] * scaleNormX,
                            p.bbox[3] * scaleNormY,
                        ],
                    }));
                }

                const scaleToCanvasX = elements.canvas.width / vWidth;
                const scaleToCanvasY = elements.canvas.height / vHeight;
                const totalCanvasArea = elements.canvas.width * elements.canvas.height;

                const validDetections = [];
                for (let i = 0; i < rawPredictions.length; i++) {
                    const item = rawPredictions[i];
                    const w = item.bbox[2] * scaleToCanvasX;
                    const h = item.bbox[3] * scaleToCanvasY;
                    const area = w * h;

                    if (area >= totalCanvasArea * MIN_BOX_AREA_RATIO) {
                        validDetections.push({
                            class: item.class,
                            score: item.score,
                            bbox: [
                                item.bbox[0] * scaleToCanvasX,
                                item.bbox[1] * scaleToCanvasY,
                                w,
                                h,
                            ],
                        });
                    }
                }

                latestDetections = validDetections;
                updateMultiTargetTracks(latestDetections);
                updateMetricsDisplay();
                renderObjectDescriptions();

            } catch (err) {
                console.warn('[Suco+] Inference error:', err);
            } finally {
                isInferring = false;
            }
        }

        if (isDetecting) {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(triggerInference, { timeout: 15 });
            } else {
                setTimeout(triggerInference, 0);
            }
        }
    }

    /**
     * Memperbarui indikator status metrik multi-objek pada toolbar.
     */
    function updateMetricsDisplay() {
        if (!elements.objectCount) return;

        const count = activeTracks.size;
        if (count === 0) {
            elements.objectCount.textContent = '0 objek di radar';
            return;
        }

        const summaryList = [];
        activeTracks.forEach((track) => {
            const info = OBJECT_DESCRIPTIONS[track.class] || { label: track.class };
            const priorityMark = track.isPriority ? '★' : '';
            summaryList.push(`${priorityMark}${track.id}:${info.label}`);
        });

        const priorityTrack = priorityTargetId ? activeTracks.get(priorityTargetId) : null;
        const lockStatus = priorityTrack && priorityTrack.isLocked ? ' [TARGET TERKUNCI]' : '';

        elements.objectCount.textContent = `${count} target (${summaryList.slice(0, 3).join(', ')})${lockStatus}`;
    }

    /**
     * Merender kartu daftar deskripsi multi-objek terdeteksi yang dapat diklik langsung untuk memin objek.
     */
    function renderObjectDescriptions() {
        if (!elements.descList) return;

        const totalTracks = activeTracks.size;

        if (totalTracks === 0) {
            if (elements.descCountBadge) elements.descCountBadge.textContent = '0 target aktif';
            elements.descList.innerHTML = '<p style="color: #64748b; font-size: 0.85rem; padding: 0.5rem 0;">Arahkan kamera ke berbagai objek untuk melihat pelacakan Multi-Target radar.</p>';
            return;
        }

        if (elements.descCountBadge) {
            elements.descCountBadge.textContent = `${totalTracks} target aktif`;
        }

        let html = '';
        activeTracks.forEach((track) => {
            const info = OBJECT_DESCRIPTIONS[track.class] || {
                label: track.class.charAt(0).toUpperCase() + track.class.slice(1),
                icon: '🎯',
                desc: `Objek teridentifikasi sebagai ${track.class} dengan akurasi ${Math.round(track.score * 100)}%.`,
            };

            const isPriority = track.isPriority;
            const isLocked = track.isLocked;
            const isPinned = (persistentUIState.pinnedObjectId === track.id);
            const borderColor = isPinned ? '#0284c7' : (isPriority ? (isLocked ? '#10b981' : '#f59e0b') : '#06b6d4');
            const scorePct = Math.round(track.score * 100);

            html += `
                <div data-target-id="${track.id}" class="radar-target-card" style="background: rgba(15, 23, 42, 0.78); border: 1.5px solid ${borderColor}; border-left: 6px solid ${borderColor}; border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; cursor: pointer; transition: all 0.2s ease;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 700; font-size: 0.95rem; color: #f8fafc; display: flex; align-items: center; gap: 0.4rem;">
                            <span>${info.icon}</span> [${track.id}] ${info.label}
                            ${isPinned ? '<span style="color:#38bdf8; font-size:0.75rem; border:1px solid #38bdf8; padding:1px 5px; border-radius:4px; font-weight:700;">📌 PINNED</span>' : ''}
                            ${isPriority && !isPinned ? (isLocked ? '<span style="color:#10b981; font-size:0.75rem; border:1px solid #10b981; padding:1px 5px; border-radius:4px; font-weight:700;">★ LOCKED</span>' : '<span style="color:#f59e0b; font-size:0.75rem; border:1px solid #f59e0b; padding:1px 5px; border-radius:4px; font-weight:700;">★ PRIORITAS</span>') : ''}
                        </span>
                        <span style="background: rgba(255,255,255,0.08); color: ${borderColor}; font-size: 0.8rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;">
                            ${scorePct}% Akurat
                        </span>
                    </div>
                    <p style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.45; margin: 0;">
                        ${info.desc}
                    </p>
                    <div style="font-size: 0.75rem; color: #94a3b8; display: flex; justify-content: space-between; margin-top: 0.2rem;">
                        <span>Kuncian: ${Math.round(track.lockProgress * 100)}%</span>
                        <span style="color: #38bdf8; text-decoration: underline;">Klik untuk Buka Kartu Detail & Kunci</span>
                    </div>
                </div>
            `;
        });

        elements.descList.innerHTML = html;

        const cards = elements.descList.querySelectorAll('.radar-target-card');
        cards.forEach((card) => {
            card.addEventListener('click', () => {
                const targetId = card.getAttribute('data-target-id');
                if (targetId && activeTracks.has(targetId)) {
                    pinObject(activeTracks.get(targetId));
                }
            });
        });
    }

    /**
     * Membangun kontainer UI Deskripsi Objek & Persistent Card Container.
     */
    function ensureDescriptionContainer() {
        let persistentBox = document.getElementById('persistentObjectBox');
        if (!persistentBox) {
            persistentBox = document.createElement('div');
            persistentBox.id = 'persistentObjectBox';
            persistentBox.style.cssText = 'padding: 0.75rem 1.25rem; display: none;';

            const controlsBar = document.querySelector('.controls-bar');
            if (controlsBar && controlsBar.parentNode) {
                controlsBar.parentNode.insertBefore(persistentBox, controlsBar.nextSibling);
            }
        }
        elements.persistentCardContainer = persistentBox;

        let container = document.getElementById('objectDescriptionBox');
        if (!container) {
            container = document.createElement('div');
            container.id = 'objectDescriptionBox';
            container.style.cssText = 'padding: 1rem 1.25rem; border-top: 1px solid #334155; background: rgba(11, 17, 32, 0.5);';

            container.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                    <h3 style="font-size: 1rem; font-weight: 600; color: #f8fafc; margin: 0; display: flex; align-items: center; gap: 0.4rem;">
                        📋 Multi-Target Radar & Deskripsi Objek
                    </h3>
                    <span id="descCountBadge" style="font-size: 0.75rem; background: #1e293b; color: #94a3b8; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #334155;">
                        0 target aktif
                    </span>
                </div>
                <div id="objectDescList">
                    <p style="color: #64748b; font-size: 0.85rem; padding: 0.5rem 0;">Arahkan kamera ke berbagai objek untuk melihat pelacakan Multi-Target radar.</p>
                </div>
            `;

            if (persistentBox && persistentBox.parentNode) {
                persistentBox.parentNode.insertBefore(container, persistentBox.nextSibling);
            }
        }

        elements.descContainer = container;
        elements.descList = document.getElementById('objectDescList');
        elements.descCountBadge = document.getElementById('descCountBadge');
    }

    /**
     * Membangun Toolbar Kontrol Multi-Target Radar & Digital Zoom secara responsif.
     */
    function ensureRadarControls() {
        let toolbar = document.getElementById('radarControlsBar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = 'radarControlsBar';
            toolbar.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.6rem 1.25rem; background: rgba(15, 23, 42, 0.88); border-top: 1px solid #1e293b; align-items: center; justify-content: space-between; touch-action: manipulation;';

            toolbar.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 700; color: #38bdf8;">
                    <span>🎯 MTT MULTI-RADAR:</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                    <button id="btnToggleRadar" type="button" style="background: #0284c7; color: #fff; border: none; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; touch-action: manipulation;">
                        🎯 HUD: ON
                    </button>
                    <button id="btnToggleSound" type="button" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; touch-action: manipulation;">
                        🔊 Audio: ON
                    </button>
                    <button id="btnToggleAutoAi" type="button" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; touch-action: manipulation;" title="Otomatis panggil AI Router saat target prioritas terkunci">
                        🤖 Auto AI: OFF
                    </button>
                    <button id="btnLockTarget" type="button" style="background: #10b981; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; touch-action: manipulation;" disabled>
                        ⚡ Kunci Target
                    </button>
                </div>
            `;

            const controlsBar = document.querySelector('.controls-bar');
            if (controlsBar && controlsBar.parentNode) {
                controlsBar.parentNode.insertBefore(toolbar, controlsBar);
            }
        }

        let zoomBar = document.getElementById('digitalZoomBar');
        if (!zoomBar) {
            zoomBar = document.createElement('div');
            zoomBar.id = 'digitalZoomBar';
            zoomBar.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.4rem 1.25rem; background: rgba(11, 17, 32, 0.95); border-top: 1px solid #1e293b; align-items: center; justify-content: space-between; font-size: 0.75rem;';

            zoomBar.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="color: #94a3b8; font-weight: 700;">🔍 DIGITAL ZOOM:</span>
                    <strong id="zoomCurrentBadge" style="color: #38bdf8; font-family: monospace;">1.0x</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <button class="btn-zoom-preset" data-zoom="1.0" type="button" style="background: #0284c7; color: #fff; border: none; padding: 0.25rem 0.55rem; border-radius: 4px; font-weight: 600; cursor: pointer;">1.0x</button>
                    <button class="btn-zoom-preset" data-zoom="2.0" type="button" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.25rem 0.55rem; border-radius: 4px; font-weight: 600; cursor: pointer;">2.0x</button>
                    <button class="btn-zoom-preset" data-zoom="3.0" type="button" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.25rem 0.55rem; border-radius: 4px; font-weight: 600; cursor: pointer;">3.0x</button>
                    <button class="btn-zoom-preset" data-zoom="5.0" type="button" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 0.25rem 0.55rem; border-radius: 4px; font-weight: 600; cursor: pointer;">5.0x</button>
                    <button id="btnZoomReset" type="button" style="background: #334155; color: #f1f5f9; border: none; padding: 0.25rem 0.55rem; border-radius: 4px; font-weight: 600; cursor: pointer;">🔄 Reset</button>
                </div>
            `;

            if (toolbar && toolbar.parentNode) {
                toolbar.parentNode.insertBefore(zoomBar, toolbar.nextSibling);
            }
        }

        elements.radarToolbar = toolbar;
        elements.zoomToolbar = zoomBar;
        elements.zoomBadge = document.getElementById('zoomCurrentBadge');
        elements.btnZoomReset = document.getElementById('btnZoomReset');
        elements.btnToggleRadar = document.getElementById('btnToggleRadar');
        elements.btnToggleSound = document.getElementById('btnToggleSound');
        elements.btnToggleAutoAi = document.getElementById('btnToggleAutoAi');
        elements.btnLockTarget = document.getElementById('btnLockTarget');

        const presetBtns = zoomBar.querySelectorAll('.btn-zoom-preset');
        presetBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const factor = parseFloat(btn.getAttribute('data-zoom') || '1.0');
                const canvasW = elements.canvas ? elements.canvas.width : 640;
                const canvasH = elements.canvas ? elements.canvas.height : 480;
                setZoom(factor, { x: canvasW / 2, y: canvasH / 2 });
            });
        });

        if (elements.btnZoomReset) {
            elements.btnZoomReset.addEventListener('click', resetZoom);
        }

        if (elements.btnToggleRadar) {
            elements.btnToggleRadar.addEventListener('click', () => {
                radarConfig.enabled = !radarConfig.enabled;
                elements.btnToggleRadar.textContent = radarConfig.enabled ? '🎯 HUD: ON' : '🎯 HUD: OFF';
                elements.btnToggleRadar.style.background = radarConfig.enabled ? '#0284c7' : '#334155';
            });
        }

        if (elements.btnToggleSound) {
            elements.btnToggleSound.addEventListener('click', () => {
                initAudioContext();
                radarConfig.soundEnabled = !radarConfig.soundEnabled;
                elements.btnToggleSound.textContent = radarConfig.soundEnabled ? '🔊 Audio: ON' : '🔇 Audio: OFF';
                elements.btnToggleSound.style.color = radarConfig.soundEnabled ? '#38bdf8' : '#94a3b8';
            });
        }

        if (elements.btnToggleAutoAi) {
            elements.btnToggleAutoAi.addEventListener('click', () => {
                radarConfig.autoAiOnLock = !radarConfig.autoAiOnLock;
                elements.btnToggleAutoAi.textContent = radarConfig.autoAiOnLock ? '🤖 Auto AI: ON' : '🤖 Auto AI: OFF';
                elements.btnToggleAutoAi.style.background = radarConfig.autoAiOnLock ? '#8b5cf6' : '#1e293b';
                elements.btnToggleAutoAi.style.color = '#fff';
            });
        }

        if (elements.btnLockTarget) {
            elements.btnLockTarget.addEventListener('click', () => {
                if (activeTracks.size > 0) {
                    const candidate = priorityTargetId ? activeTracks.get(priorityTargetId) : activeTracks.values().next().value;
                    if (candidate) {
                        pinObject(candidate);
                    }
                }
            });
        }
    }

    /**
     * Menangani interaksi Tap-to-Lock & Pin Object instan pada layar video/kanvas.
     * @param {MouseEvent|TouchEvent} event
     */
    function handleCanvasTapToLock(event) {
        if (!elements.canvas || activeTracks.size === 0) return;

        initAudioContext();
        const rect = elements.canvas.getBoundingClientRect();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        const scaleX = elements.canvas.width / rect.width;
        const scaleY = elements.canvas.height / rect.height;
        const tapScreenX = (clientX - rect.left) * scaleX;
        const tapScreenY = (clientY - rect.top) * scaleY;

        let closestTrack = null;
        let shortestDist = 999999;

        activeTracks.forEach((track) => {
            const [sxBox, syBox, swBox, shBox] = transformBoxToScreen(
                track.reticle.x,
                track.reticle.y,
                track.reticle.w,
                track.reticle.h,
                elements.canvas.width,
                elements.canvas.height
            );

            if (tapScreenX >= sxBox && tapScreenX <= sxBox + swBox && tapScreenY >= syBox && tapScreenY <= syBox + shBox) {
                closestTrack = track;
                shortestDist = 0;
            } else {
                const cx = sxBox + swBox / 2;
                const cy = syBox + shBox / 2;
                const dist = Math.hypot(tapScreenX - cx, tapScreenY - cy);
                if (dist < shortestDist && dist < 120) {
                    shortestDist = dist;
                    closestTrack = track;
                }
            }
        });

        if (closestTrack) {
            pinObject(closestTrack);
        }
    }

    /**
     * Menangani gestur Mouse Wheel & Touch Pinch untuk Digital Zoom halus pada canvas.
     */
    function initZoomInteractions() {
        if (!elements.canvas) return;

        elements.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = elements.canvas.getBoundingClientRect();
            const scaleX = elements.canvas.width / rect.width;
            const scaleY = elements.canvas.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;

            const delta = e.deltaY < 0 ? 0.3 : -0.3;
            setZoom(zoomViewportState.scale + delta, { x: mouseX, y: mouseY });
        }, { passive: false });

        let initialDistance = 0;
        let initialScale = 1.0;

        elements.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                initialDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialScale = zoomViewportState.scale;
            }
        }, { passive: true });

        elements.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && initialDistance > 0) {
                e.preventDefault();
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const rect = elements.canvas.getBoundingClientRect();
                const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) * (elements.canvas.width / rect.width);
                const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) * (elements.canvas.height / rect.height);

                const newScale = initialScale * (currentDist / initialDistance);
                setZoom(newScale, { x: midX, y: midY });
            }
        }, { passive: false });
    }

    /**
     * Menghitung nilai FPS dengan penghalusan.
     */
    function calculateFps() {
        frameCount++;
        const now = performance.now();
        const elapsed = now - lastFpsUpdate;

        if (elapsed >= 500) {
            currentFps = Math.round((frameCount * 1000) / elapsed);
            if (elements.fpsCounter) {
                elements.fpsCounter.textContent = String(currentFps);
            }
            frameCount = 0;
            lastFpsUpdate = now;
        }
    }

    /**
     * Mengambil snapshot frame kamera saat ini.
     * @returns {string|null}
     */
    function captureSnapshotDataUri() {
        if (!elements.video || !stream) {
            return null;
        }

        const width = elements.video.videoWidth || 640;
        const height = elements.video.videoHeight || 480;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;

        const offscreenCtx = offscreenCanvas.getContext('2d');
        offscreenCtx.drawImage(elements.video, 0, 0, width, height);

        return offscreenCanvas.toDataURL('image/jpeg', 0.85);
    }

    /**
     * Handler untuk menyimpan snapshot ke backend via SucoAPI.
     */
    async function handleSaveSnapshot() {
        const imageB64 = captureSnapshotDataUri();
        if (!imageB64) {
            alert('Aktifkan kamera terlebih dahulu untuk mengambil snapshot.');
            return;
        }

        if (typeof window.SucoAPI === 'undefined') {
            alert('Modul SucoAPI belum siap.');
            return;
        }

        const prevText = elements.btnSnapshot ? elements.btnSnapshot.textContent : '';
        if (elements.btnSnapshot) {
            elements.btnSnapshot.disabled = true;
            elements.btnSnapshot.textContent = 'Menyimpan...';
        }

        try {
            const result = await window.SucoAPI.saveSnapshot(imageB64);
            alert(`Snapshot berhasil disimpan!\nFile: ${result.filename}\nUkuran: ${(result.size_bytes / 1024).toFixed(1)} KB`);
        } catch (err) {
            console.error('[Suco+] Gagal menyimpan snapshot:', err);
            alert(`Gagal menyimpan snapshot: ${err.message}`);
        } finally {
            if (elements.btnSnapshot) {
                elements.btnSnapshot.disabled = false;
                elements.btnSnapshot.textContent = prevText || 'Ambil Snapshot';
            }
        }
    }

    /**
     * Handler untuk mengirim snapshot dan multi-objek ke AI Router via SucoAPI.
     */
    async function handleAnalyzeAI() {
        if (typeof window.SucoAPI === 'undefined') {
            alert('Modul SucoAPI belum siap.');
            return;
        }

        const imageB64 = captureSnapshotDataUri();
        const promptText = elements.aiPrompt ? elements.aiPrompt.value.trim() : '';

        if (elements.aiResultBox) {
            elements.aiResultBox.classList.remove('hidden');
        }
        if (elements.aiResultText) {
            elements.aiResultText.textContent = 'Menghubungkan ke AI Router (Gemini / DeepSeek)... Mohon tunggu.';
        }
        if (elements.aiProviderBadge) {
            elements.aiProviderBadge.textContent = 'Memproses...';
            elements.aiProviderBadge.className = 'status-badge status-loading';
        }

        const prevBtnText = elements.btnAnalyzeAI ? elements.btnAnalyzeAI.textContent : '';
        if (elements.btnAnalyzeAI) {
            elements.btnAnalyzeAI.disabled = true;
            elements.btnAnalyzeAI.textContent = 'Menganalisis...';
        }

        try {
            const tracksPayload = [];
            activeTracks.forEach((tr) => {
                tracksPayload.push({
                    id: tr.id,
                    class: tr.class,
                    score: tr.score,
                    bbox: tr.bbox,
                    is_priority: tr.isPriority,
                    is_locked: tr.isLocked,
                });
            });

            const response = await window.SucoAPI.analyzeAI({
                detections: tracksPayload.length > 0 ? tracksPayload : latestDetections,
                prompt: promptText,
                image: imageB64,
            });

            if (elements.aiResultText) {
                elements.aiResultText.textContent = response.analysis || 'Analisis selesai tanpa teks.';
            }

            if (elements.aiProviderBadge) {
                const providerName = response.provider_used ? response.provider_used.toUpperCase() : 'AI';
                const fallbackNote = response.fallback_triggered ? ' (Fallback)' : '';
                elements.aiProviderBadge.textContent = `${providerName}${fallbackNote}`;
                elements.aiProviderBadge.className = 'status-badge status-ready';
            }

        } catch (err) {
            console.error('[Suco+] AI Analysis error:', err);
            if (elements.aiResultText) {
                elements.aiResultText.textContent = `Gagal mendapatkan analisis: ${err.message}`;
            }
            if (elements.aiProviderBadge) {
                elements.aiProviderBadge.textContent = 'Error';
                elements.aiProviderBadge.className = 'status-badge status-error';
            }
        } finally {
            if (elements.btnAnalyzeAI) {
                elements.btnAnalyzeAI.disabled = false;
                elements.btnAnalyzeAI.textContent = prevBtnText || 'Analisis dengan AI';
            }
        }
    }

    // ==========================================
    // 12. INISIALISASI MODUL & EVENT BINDINGS
    // ==========================================

    /**
     * Memeriksa dan memulihkan status kamera jika pengguna baru kembali dari Halaman Detail Objek.
     * Sesuai Spesifikasi Bagian 6 (Strategi Retensi Koneksi Kamera Utama).
     */
    function checkAndRestoreCameraState() {
        try {
            const raw = sessionStorage.getItem('suco_camera_restore_state');
            if (raw) {
                const restoreData = JSON.parse(raw);
                if (restoreData.scale && restoreData.scale > 1.0) {
                    zoomViewportState.scale = restoreData.scale;
                    zoomViewportState.isZooming = true;
                    if (restoreData.centerPoint) {
                        zoomViewportState.centerPoint = restoreData.centerPoint;
                    }
                }
                if (restoreData.facingMode) {
                    currentFacingMode = restoreData.facingMode;
                }
                if (restoreData.pinnedObjectId) {
                    userPinnedTargetId = restoreData.pinnedObjectId;
                }
                sessionStorage.removeItem('suco_camera_restore_state');
            }
        } catch (e) {
            console.warn('[Suco+] Gagal memulihkan status kamera:', e);
        }
    }

    /**
     * Inisialisasi binding DOM dan Event Listeners saat halaman siap.
     */
    function init() {
        checkAndRestoreCameraState();
        ensureDescriptionContainer();
        ensureRadarControls();

        elements.stage = document.querySelector('.camera-stage');
        elements.video = document.getElementById('webcam');
        elements.canvas = document.getElementById('overlay');
        elements.placeholder = document.getElementById('cameraPlaceholder');
        elements.btnStart = document.getElementById('btnStart');
        elements.btnStop = document.getElementById('btnStop');
        elements.btnSwitchCamera = document.getElementById('btnSwitchCamera');
        elements.btnSnapshot = document.getElementById('btnSnapshot');
        elements.btnAnalyzeAI = document.getElementById('btnAnalyzeAI');
        elements.statusBadge = document.getElementById('statusBadge');
        elements.objectCount = document.getElementById('objectCount');
        elements.fpsCounter = document.getElementById('fpsCounter');
        elements.aiPrompt = document.getElementById('aiPrompt');
        elements.aiResultBox = document.getElementById('aiResultBox');
        elements.aiResultText = document.getElementById('aiResultText');
        elements.aiProviderBadge = document.getElementById('aiProviderBadge');

        if (elements.canvas) {
            elements.ctx = elements.canvas.getContext('2d');
            elements.canvas.style.touchAction = 'none';
            elements.canvas.addEventListener('click', handleCanvasTapToLock);
            elements.canvas.addEventListener('touchstart', handleCanvasTapToLock, { passive: true });
            initZoomInteractions();
        }

        if (elements.btnStart) {
            elements.btnStart.addEventListener('click', startCamera);
        }
        if (elements.btnStop) {
            elements.btnStop.addEventListener('click', stopCamera);
        }
        if (elements.btnSwitchCamera) {
            elements.btnSwitchCamera.addEventListener('click', switchCamera);
        }
        if (elements.btnSnapshot) {
            elements.btnSnapshot.addEventListener('click', handleSaveSnapshot);
        }
        if (elements.btnAnalyzeAI) {
            elements.btnAnalyzeAI.addEventListener('click', handleAnalyzeAI);
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isDetecting) {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            } else if (!document.hidden && isDetecting && !animationFrameId) {
                lastRenderTime = performance.now();
                renderLoop();
            }
        });

        loadModel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API Ekspor (Memenuhi Interface Spesifikasi 4.1 & 4.2)
    window.SucoCamera = {
        startCamera,
        stopCamera,
        switchCamera,
        setZoom,
        resetZoom,
        focusOnObject,
        pinObject,
        dismissPinnedObject,
        updatePinnedMetadata,
        openObjectDetailsPage,
        captureHighResObjectCrop,
        getPersistentUIState: () => ({ ...persistentUIState }),
        getZoomState: () => ({ ...zoomViewportState }),
        getFacingMode: () => currentFacingMode,
        captureSnapshot: captureSnapshotDataUri,
        getLatestDetections: () => [...latestDetections],
        getActiveTracks: () => new Map(activeTracks),
        getPriorityTargetId: () => priorityTargetId,
        getModel: () => model,
        loadModel,
    };

})(typeof window !== 'undefined' ? window : this, document);
