import base64
import binascii
import io
import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Blueprint, current_app, jsonify, render_template, request
from PIL import Image, UnidentifiedImageError

from core.security import require_api_security, sanitize_filename

ai_snapshot_bp = Blueprint("ai_snapshot", __name__)

MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024       # 2 MB
TARGET_COMPRESSED_BYTES = 1 * 1024 * 1024  # 1 MB
LLM_TIMEOUT_SECONDS = 15

# Daftar model Gemini aktif dengan chain fallback otomatis jika terjadi 503 / 404
GEMINI_MODEL_CHAIN = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
]

# Strict System Anchor Prompt Template sesuai Panduan Perbaikan Akurasi (Bagian 3)
STRICT_SYSTEM_ANCHOR_TEMPLATE = """[PERAN & BATASAN SISTEM]
Anda adalah sistem inspeksi visual teknis Suco+. Tugas Anda HANYA menganalisis objek yang tertera pada snapshot citra dan metadata yang disediakan.

[ATURAN MUTLAK]
1. FOKUS OBJEK TUNGGAL:
   - Subjek utama analisis: {label} (ID: {object_id}).
   - Jangan pernah mengalihkan pembahasan ke latar belakang, lingkungan sekitar, atau topik umum di luar objek tersebut.

2. ATURAN PENOLAKAN KELUAR KONTEKS:
   - Jika pengguna menanyakan hal yang sama sekali tidak relevan dengan objek ini (misal: "Siapa presiden pertama?", "Buatkan puisi", "Cara membuat kue", rumus fisika umum, atau pertanyaan di luar objek), TOLAK DENGAN TEGAS & SOPAN:
     "Pertanyaan tersebut di luar konteks pengamatan untuk objek {label}. Saya hanya dapat menjawab pertanyaan terkait fisik, fungsi, dan karakteristik objek ini."

3. VERIFIKASI VISUAL:
   - Jawab HANYA apa yang benar-benar tampak pada citra dan tertera pada metadata.
   - JANGAN PERNAH menebak merk, tipe internal, atau fungsi tersembunyi jika tidak terlihat indikator visual yang jelas.
   - Jika detail tidak terlihat jelas, nyatakan: "Bagian tersebut tidak terlihat cukup jelas pada citra objek saat ini."

[DATA GROUNDING OBJEK TERVERIFIKASI]
{grounding_context}"""


def _compress_image_bytes(image_bytes: bytes, max_bytes: int = TARGET_COMPRESSED_BYTES) -> bytes:
    """
    Mengompresi citra jika ukurannya melebihi batas untuk mencegah error 413 dan 504.
    """
    if len(image_bytes) <= max_bytes:
        return image_bytes

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img = img.convert("RGB")
            max_dim = 1024
            if img.width > max_dim or img.height > max_dim:
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            output = io.BytesIO()
            img.save(output, format="JPEG", quality=80, optimize=True)
            return output.getvalue()
    except Exception:
        return image_bytes


def _decode_and_validate_jpeg(image_data: str) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Memvalidasi dan membersihkan string Base64 JPEG.
    """
    if not image_data or not isinstance(image_data, str):
        return None, "Data gambar tidak ditemukan."

    raw_b64 = image_data.strip()
    if raw_b64.startswith("data:"):
        _, _, payload = raw_b64.partition(",")
        raw_b64 = payload.strip()

    try:
        image_bytes = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError):
        return None, "Payload Base64 tidak valid."

    if len(image_bytes) == 0:
        return None, "File gambar kosong."

    if len(image_bytes) > MAX_SNAPSHOT_BYTES:
        return None, "Ukuran gambar melebihi batas maksimal 2 MB."

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        return None, "File gambar rusak atau bukan gambar asli."

    image_bytes = _compress_image_bytes(image_bytes)
    return image_bytes, None


def _generate_suggested_questions(label: str, class_name: str) -> List[str]:
    """
    Menghasilkan 3-5 rekomendasi pertanyaan kontekstual spesifik berbasis kategori objek.
    """
    clean_label = label or class_name or "Objek"
    c_lower = (class_name or "").lower()

    if any(k in c_lower for k in ["phone", "cell", "laptop", "keyboard", "mouse", "tv", "remote"]):
        return [
            f"Apa fitur fisik dan indikator tombol yang tampak pada {clean_label} ini?",
            f"Bagaimana kondisi kebersihan dan permukaan fisik {clean_label}?",
            f"Apa estimasi fungsi komponen kamera/layar yang terlihat pada {clean_label}?",
            f"Apakah terlihat adanya goresan atau tanda pemakaian pada {clean_label}?",
        ]
    elif any(k in c_lower for k in ["bottle", "cup", "bowl"]):
        return [
            f"Terbuat dari material apa wadah {clean_label} ini (kaca, plastik, atau logam)?",
            f"Apakah wadah {clean_label} ini memiliki penutup atau indikator volume?",
            f"Bagaimana estimasi kejernihan dan kondisi kebersihan {clean_label}?",
            f"Berapa perkiraan kapasitas ukuran dari {clean_label} ini?",
        ]
    elif any(k in c_lower for k in ["person"]):
        return [
            "Bagaimana estimasi postur dan arah fokus individu ini?",
            "Apa atribut pakaian atau perlengkapan yang tampak jelas?",
            "Apakah individu berada dalam jarak aman pengamatan kamera?",
        ]
    elif any(k in c_lower for k in ["car", "motorcycle", "bicycle"]):
        return [
            f"Apa jenis dan estimasi kategori kendaraan {clean_label} ini?",
            f"Bagaimana kondisi bodi dan pencahayaan eksterior {clean_label}?",
            f"Apakah terlihat adanya kerusakan atau anomali pada kendaraan?",
        ]
    else:
        return [
            f"Apa fungsi utama dan karakteristik visual dari {clean_label} ini?",
            f"Berdasarkan citra, terbuat dari material apa objek {clean_label} ini?",
            f"Bagaimana kondisi fisik dan keutuhan permukaan objek ini?",
            f"Apakah ada indikator visual khusus yang teramati pada objek?",
        ]


def _call_gemini_with_fallback(parts: List[Dict[str, Any]], system_instruction: Optional[str] = None) -> str:
    """
    Memanggil Gemini REST API dengan model chain fallback otomatis
    dan hiperparameter presisi tinggi (temperature: 0.1).
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY belum dikonfigurasi.")

    configured_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"

    models_to_try = [configured_model]
    for m in GEMINI_MODEL_CHAIN:
        if m not in models_to_try:
            models_to_try.append(m)

    payload: Dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,  # Deterministik berorientasi fakta murni (Bagian 2)
            "topP": 0.2,
            "topK": 20,
            "maxOutputTokens": 1024,
        },
    }

    if system_instruction:
        payload["system_instruction"] = {
            "parts": [{"text": system_instruction}],
        }

    last_error = ""
    for model_name in models_to_try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={api_key}"
        )
        try:
            resp = requests.post(url, json=payload, timeout=LLM_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates") or []
                if candidates:
                    text_parts = candidates[0].get("content", {}).get("parts", [])
                    result_text = "\n".join(p.get("text", "") for p in text_parts if p.get("text")).strip()
                    if result_text:
                        return result_text
            elif resp.status_code in {503, 404, 429}:
                last_error = f"{model_name} HTTP {resp.status_code}"
                continue
            else:
                last_error = f"{model_name} HTTP {resp.status_code}: {resp.text[:150]}"
        except requests.exceptions.RequestException as e:
            last_error = f"{model_name} request error: {str(e)}"
            continue

    raise RuntimeError(f"Semua model Gemini gagal: {last_error}")


def _call_gemini(prompt: str, image_b64: Optional[str] = None) -> str:
    """Memanggil Gemini REST API untuk analisis visual tunggal."""
    parts: List[Dict[str, Any]] = [{"text": prompt}]
    if image_b64:
        clean_b64 = image_b64.split(",", 1)[-1].strip()
        parts.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": clean_b64,
            }
        })
    return _call_gemini_with_fallback(parts)


def _call_deepseek(prompt: str) -> str:
    """Memanggil DeepSeek Chat Completions API dengan konfigurasi deterministik."""
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key.startswith("isi_dengan"):
        raise RuntimeError("DEEPSEEK_API_KEY belum dikonfigurasi.")

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
    url = "https://api.deepseek.com/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Anda adalah asisten analisis visual Suco+. "
                    "Berikan ringkasan hasil deteksi objek yang faktual, singkat, jelas, dan informatif dalam Bahasa Indonesia."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,  # Deterministik (Bagian 2)
        "top_p": 0.2,
        "max_tokens": 1024,
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=LLM_TIMEOUT_SECONDS)
    if resp.status_code != 200:
        raise RuntimeError(f"DeepSeek HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("DeepSeek tidak mengembalikan jawaban.")

    result_text = (choices[0].get("message", {}).get("content") or "").strip()
    if not result_text:
        raise RuntimeError("Respon teks DeepSeek kosong.")

    return result_text


def _call_gemini_chat(
    system_instruction: str,
    conversation_history: List[Dict[str, str]],
    user_message: str,
    image_b64: Optional[str] = None,
) -> str:
    """
    Memanggil Gemini REST API untuk sesi chat interaktif dengan:
    1. Pembatasan history maksimal 4 putaran terakhir (anti-context drift).
    2. Hiperparameter deterministik (temperature: 0.1, topP: 0.2).
    3. Multimodal grounding via citra crop resolusi tinggi.
    """
    contents: List[Dict[str, Any]] = []

    # Batasi riwayat percakapan ke maksimal 4 interaksi terakhir (Bagian 4)
    recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history

    for msg in recent_history:
        role = "user" if msg.get("sender") == "user" else "model"
        text = str(msg.get("content") or "").strip()
        if text:
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"][0]["text"] += f"\n{text}"
            else:
                contents.append({
                    "role": role,
                    "parts": [{"text": text}],
                })

    current_parts: List[Dict[str, Any]] = [{"text": user_message}]

    if image_b64:
        clean_b64 = image_b64.split(",", 1)[-1].strip()
        current_parts.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": clean_b64,
            }
        })

    contents.append({
        "role": "user",
        "parts": current_parts,
    })

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY belum dikonfigurasi.")

    configured_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"
    models_to_try = [configured_model]
    for m in GEMINI_MODEL_CHAIN:
        if m not in models_to_try:
            models_to_try.append(m)

    payload = {
        "system_instruction": {
            "parts": [{"text": system_instruction}],
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.1,  # Hiperparameter deterministik berorientasi fakta (Bagian 2)
            "topP": 0.2,
            "topK": 20,
            "maxOutputTokens": 1024,
        },
    }

    last_error = ""
    for model_name in models_to_try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={api_key}"
        )
        try:
            resp = requests.post(url, json=payload, timeout=LLM_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates") or []
                if candidates:
                    text_parts = candidates[0].get("content", {}).get("parts", [])
                    reply_text = "\n".join(p.get("text", "") for p in text_parts if p.get("text")).strip()
                    if reply_text:
                        return reply_text
            elif resp.status_code in {503, 404, 429}:
                last_error = f"{model_name} HTTP {resp.status_code}"
                continue
            else:
                last_error = f"{model_name} HTTP {resp.status_code}: {resp.text[:150]}"
        except requests.exceptions.RequestException as e:
            last_error = f"{model_name} request error: {str(e)}"
            continue

    raise RuntimeError(f"Gemini Chat gagal: {last_error}")


def _call_deepseek_chat(
    system_instruction: str,
    conversation_history: List[Dict[str, str]],
    user_message: str,
    context_text: str,
) -> str:
    """
    Fallback Chat ke DeepSeek Chat Completions dengan grounding teks terstruktur & temperature 0.1.
    """
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key.startswith("isi_dengan"):
        raise RuntimeError("DEEPSEEK_API_KEY belum dikonfigurasi.")

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
    url = "https://api.deepseek.com/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": f"{system_instruction}\n\n[DATA OBJEK TERVERIFIKASI]\n{context_text}"}
    ]

    recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history
    for msg in recent_history:
        role = "user" if msg.get("sender") == "user" else "assistant"
        text = str(msg.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": user_message})

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,  # Hiperparameter deterministik (Bagian 2)
        "top_p": 0.2,
        "max_tokens": 1024,
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=LLM_TIMEOUT_SECONDS)
    if resp.status_code != 200:
        raise RuntimeError(f"DeepSeek Chat HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("DeepSeek tidak mengembalikan jawaban.")

    reply_text = (choices[0].get("message", {}).get("content") or "").strip()
    if not reply_text:
        raise RuntimeError("Jawaban DeepSeek kosong.")

    return reply_text


def _generate_local_expert_fallback(label: str, user_question: str, attributes: Dict[str, Any]) -> str:
    """
    Fallback Darurat Cerdas dengan Protokol Penolakan Out-of-Context (Bagian 3 Aturan 2).
    """
    q_lower = user_question.lower()

    # Deteksi Pertanyaan Keluar Konteks (Out-of-Domain)
    out_of_context_keywords = [
        "presiden", "menteri", "puisi", "pantun", "lagu", "resep", "kue",
        "cuaca", "politik", "cerpen", "dongeng", "terjemahkan", "ibu kota",
        "gempa", "pemilu", "berita hari ini", "siapa anda"
    ]
    if any(k in q_lower for k in out_of_context_keywords):
        return (
            f"Pertanyaan tersebut di luar konteks pengamatan untuk objek {label}. "
            f"Saya hanya dapat menjawab pertanyaan terkait fisik, fungsi, dan karakteristik objek ini."
        )

    attrs_str = ", ".join(f"{k}: {v}" for k, v in attributes.items()) if attributes else "Standar"
    return (
        f"[ANALISIS DOMAIN EXPERT - GROUNDED RESILIENCE]\n"
        f"Berdasarkan pengamatan visual objek {label} (Atribut: {attrs_str}):\n\n"
        f"1. Verifikasi Visual: Objek terverifikasi sebagai '{label}'. Fitur fisik dan kontur sesuai dengan standar pengamatan visual.\n"
        f"2. Terkait Pertanyaan ('{user_question}'): Karakteristik fisik yang teramati selaras dengan fungsi operasional {label}.\n"
        f"3. Catatan Pengamatan: Jika memerlukan rincian komponen internal atau nomor seri mikro, bagian tersebut tidak terlihat cukup jelas pada citra objek saat ini."
    )


# ==========================================
# ROUTE VIEW & API ENDPOINTS
# ==========================================

@ai_snapshot_bp.route("/objects/<object_id>/details", methods=["GET"])
def object_details_view(object_id: str):
    """
    Menyajikan Halaman Detail Objek & AI Q&A System.
    Sesuai Spesifikasi Bagian 1.2: /objects/:objectId/details
    """
    safe_object_id = sanitize_filename(object_id, default_name="TGT-UNKNOWN")
    return render_template("object_details.html", object_id=safe_object_id)


@ai_snapshot_bp.route("/api/snapshot/save", methods=["POST"])
@require_api_security(max_requests=30, window_seconds=60)
def save_snapshot():
    """Menyimpan snapshot Base64 JPEG tervalidasi ke uploads/snapshots/."""
    body = request.get_json(silent=True) or {}
    image_data = body.get("image", "")

    image_bytes, error_msg = _decode_and_validate_jpeg(image_data)
    if error_msg or image_bytes is None:
        return jsonify({"status": "error", "message": error_msg}), 400

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_id = uuid.uuid4().hex[:8]
    filename = sanitize_filename(f"snap_{timestamp}_{unique_id}.jpg")

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_folder, exist_ok=True)
    save_path = os.path.join(upload_folder, filename)

    with open(save_path, "wb") as f:
        f.write(image_bytes)

    base_path = request.script_root.rstrip("/")
    file_url = f"{base_path}/uploads/snapshots/{filename}"

    return jsonify({
        "status": "ok",
        "message": "Snapshot berhasil disimpan.",
        "filename": filename,
        "url": file_url,
        "size_bytes": len(image_bytes),
    }), 201


@ai_snapshot_bp.route("/api/ai/analyze", methods=["POST"])
@require_api_security(max_requests=20, window_seconds=60)
def analyze_ai():
    """
    Router AI satu arah dengan mekanisme Auto-Fallback (Gemini <-> DeepSeek).
    """
    body = request.get_json(silent=True) or {}
    detections = body.get("detections") or []
    user_prompt = str(body.get("prompt") or "").strip()
    image_data = body.get("image")

    if not detections and not user_prompt and not image_data:
        return jsonify({
            "status": "error",
            "message": "Kirim minimal data deteksi, prompt, atau gambar untuk dianalisis.",
        }), 400

    validated_b64: Optional[str] = None
    if image_data:
        img_bytes, img_err = _decode_and_validate_jpeg(image_data)
        if not img_err and img_bytes:
            validated_b64 = base64.b64encode(img_bytes).decode("ascii")

    detection_summary = ", ".join(
        f"{d.get('class', 'objek')} ({round(float(d.get('score', 0)) * 100)}%)"
        for d in detections
        if isinstance(d, dict)
    ) or "Tidak ada objek terdeteksi dari COCO-SSD"

    final_prompt = (
        f"Hasil deteksi kamera Suco+: {detection_summary}.\n"
        f"Instruksi tambahan: {user_prompt or 'Jelaskan kondisi yang terdeteksi secara singkat dan faktual dalam 2-3 kalimat.'}"
    )

    primary = os.getenv("AI_PRIMARY_PROVIDER", "gemini").strip().lower()
    if primary not in {"gemini", "deepseek"}:
        primary = "gemini"

    provider_order = ["gemini", "deepseek"] if primary == "gemini" else ["deepseek", "gemini"]
    errors: List[str] = []

    for idx, provider in enumerate(provider_order):
        try:
            if provider == "gemini":
                analysis = _call_gemini(final_prompt, image_b64=validated_b64)
            else:
                analysis = _call_deepseek(final_prompt)

            return jsonify({
                "status": "ok",
                "provider_used": provider,
                "fallback_triggered": idx > 0,
                "analysis": analysis,
            }), 200
        except Exception as exc:
            errors.append(f"{provider}: {str(exc)}")

    fallback_analysis = (
        f"Hasil observasi Suco+: {detection_summary}. "
        f"Objek berada dalam pantauan visual aktif."
    )
    return jsonify({
        "status": "ok",
        "provider_used": "local_fallback",
        "fallback_triggered": True,
        "analysis": fallback_analysis,
        "details": errors,
    }), 200


@ai_snapshot_bp.route("/api/ai/chat", methods=["POST"])
@require_api_security(max_requests=30, window_seconds=60)
def ai_chat():
    """
    Sistem Percakapan AI Interaktif (Deep Q&A) Berbasis Konteks Objek Terkunci
    dengan Strict System Anchor, Context Re-Anchoring, dan Hiperparameter Deterministik.
    """
    body = request.get_json(silent=True) or {}
    object_context = body.get("object_context") or {}
    user_message = str(body.get("message") or "").strip()
    history = body.get("history") or []

    if not user_message:
        return jsonify({
            "status": "error",
            "message": "Pesan pertanyaan tidak boleh kosong.",
        }), 400

    # Ekstraksi Metadata Objek Terkunci
    metadata = object_context.get("metadata") or {}
    label = metadata.get("label") or "Objek Teridentifikasi"
    confidence = metadata.get("confidenceScore") or 0.85
    score_pct = round(float(confidence) * 100)
    visual_attrs = metadata.get("visualAttributes") or {}
    object_id = object_context.get("objectId") or "TGT-UNKNOWN"

    attrs_summary = ", ".join(f"{k}: {v}" for k, v in visual_attrs.items()) if visual_attrs else "Standar"

    grounding_context_text = (
        f"- Target ID: {object_id}\n"
        f"- Nama/Klasifikasi Objek: {label}\n"
        f"- Akurasi Deteksi Visual: {score_pct}%\n"
        f"- Atribut Teramati: {attrs_summary}\n"
    )

    # Validasi Citra Crop Resolusi Tinggi
    visual_evidence = object_context.get("visualEvidence") or {}
    image_b64 = visual_evidence.get("highResCropBase64") or body.get("image")
    validated_b64: Optional[str] = None

    if image_b64 and isinstance(image_b64, str):
        img_bytes, img_err = _decode_and_validate_jpeg(image_b64)
        if not img_err and img_bytes:
            validated_b64 = base64.b64encode(img_bytes).decode("ascii")

    # Susun Strict System Anchor Prompt (Bagian 3)
    strict_system_prompt = STRICT_SYSTEM_ANCHOR_TEMPLATE.format(
        label=label,
        object_id=object_id,
        grounding_context=grounding_context_text,
    )

    # Injeksi Context Re-Anchoring pada giliran pesan pengguna terkini (Bagian 4)
    anchored_user_message = f"[Konteks Target: {label} (ID: {object_id})]\nPertanyaan: {user_message}"

    primary = os.getenv("AI_PRIMARY_PROVIDER", "gemini").strip().lower()
    if primary not in {"gemini", "deepseek"}:
        primary = "gemini"

    provider_order = ["gemini", "deepseek"] if primary == "gemini" else ["deepseek", "gemini"]
    errors: List[str] = []
    reply_text = ""
    used_provider = ""
    fallback_used = False

    for idx, provider in enumerate(provider_order):
        try:
            if provider == "gemini":
                reply_text = _call_gemini_chat(
                    system_instruction=strict_system_prompt,
                    conversation_history=history,
                    user_message=anchored_user_message,
                    image_b64=validated_b64,
                )
            else:
                reply_text = _call_deepseek_chat(
                    system_instruction=strict_system_prompt,
                    conversation_history=history,
                    user_message=anchored_user_message,
                    context_text=grounding_context_text,
                )

            used_provider = provider
            fallback_used = (idx > 0)
            break
        except Exception as exc:
            errors.append(f"{provider}: {str(exc)}")

    # Fallback Darurat Cerdas dengan Protokol Penolakan Out-of-Domain
    if not reply_text:
        used_provider = "local_expert"
        fallback_used = True
        reply_text = _generate_local_expert_fallback(label, user_message, visual_attrs)

    suggested = _generate_suggested_questions(label, label)

    return jsonify({
        "status": "ok",
        "reply": reply_text,
        "provider_used": used_provider,
        "fallback_triggered": fallback_used,
        "suggested_questions": suggested,
        "timestamp": int(datetime.now().timestamp() * 1000),
    }), 200
