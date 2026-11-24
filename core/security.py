import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque
from functools import wraps
from typing import Any, Callable, Deque, Dict, Optional
from urllib.parse import urlparse

from flask import jsonify, request, session

# Penyimpanan in-memory untuk rate limiter (aman untuk multi-thread)
_RATE_LIMIT_STORE: Dict[str, Deque[float]] = defaultdict(deque)
_RATE_LIMIT_LOCK = threading.Lock()


def _get_client_ip() -> str:
    """
    Mengambil alamat IP klien.
    Mendukung reverse proxy standar (cPanel/Nginx) melalui X-Forwarded-For.
    """
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _is_same_origin() -> bool:
    """
    Memvalidasi bahwa permintaan berasal dari origin yang sama
    dengan memeriksa header Origin atau fallback ke Referer.
    """
    expected = urlparse(request.host_url)
    expected_origin = (expected.scheme.lower(), expected.netloc.lower())

    origin_header = request.headers.get("Origin", "").strip()
    if origin_header:
        parsed_origin = urlparse(origin_header)
        return (parsed_origin.scheme.lower(), parsed_origin.netloc.lower()) == expected_origin

    referer_header = request.headers.get("Referer", "").strip()
    if referer_header:
        parsed_referer = urlparse(referer_header)
        return (parsed_referer.scheme.lower(), parsed_referer.netloc.lower()) == expected_origin

    return False


def _check_rate_limit(client_ip: str, max_requests: int, window_seconds: int) -> Optional[int]:
    """
    Mengecek batas permintaan per IP dalam jendela waktu tertentu.
    Mengembalikan None jika diizinkan, atau sisa detik (Retry-After) jika melampaui batas.
    """
    now = time.monotonic()
    cutoff = now - window_seconds

    with _RATE_LIMIT_LOCK:
        timestamps = _RATE_LIMIT_STORE[client_ip]

        # Bersihkan timestamp yang sudah melewati window_seconds
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()

        if len(timestamps) >= max_requests:
            retry_after = max(1, int(window_seconds - (now - timestamps[0])) + 1)
            return retry_after

        timestamps.append(now)
        return None


def require_api_security(max_requests: int = 30, window_seconds: int = 60) -> Callable:
    """
    Decorator Flask untuk melindungi endpoint API:
    1. Rate Limiting in-memory per IP (HTTP 429 jika melebihi batas).
    2. Validasi Same-Origin melalui header Origin / Referer (HTTP 403).
    3. Validasi CSRF Token header X-CSRFToken terhadap session['csrf_token']
       menggunakan hmac.compare_digest (HTTP 403).
    """
    def decorator(view_func: Callable) -> Callable:
        @wraps(view_func)
        def wrapped(*args: Any, **kwargs: Any):
            # 1. Rate Limiting per IP
            client_ip = _get_client_ip()
            retry_after = _check_rate_limit(client_ip, max_requests, window_seconds)
            if retry_after is not None:
                response = jsonify({
                    "status": "error",
                    "message": "Terlalu banyak permintaan. Silakan coba lagi nanti.",
                    "retry_after": retry_after,
                })
                response.status_code = 429
                response.headers["Retry-After"] = str(retry_after)
                return response

            # 2. Validasi Same-Origin (Origin / Referer)
            if not _is_same_origin():
                return jsonify({
                    "status": "error",
                    "message": "Akses ditolak: Origin tidak valid.",
                }), 403

            # 3. Validasi CSRF Token menggunakan hmac.compare_digest
            session_token = session.get("csrf_token", "")
            header_token = request.headers.get("X-CSRFToken", "")

            if (
                not isinstance(session_token, str)
                or not isinstance(header_token, str)
                or not session_token
                or not header_token
                or not hmac.compare_digest(session_token, header_token)
            ):
                return jsonify({
                    "status": "error",
                    "message": "Akses ditolak: CSRF token tidak valid atau kosong.",
                }), 403

            return view_func(*args, **kwargs)

        return wrapped

    return decorator


def mask_secret(value: Optional[str], visible_start: int = 4, visible_end: int = 4) -> str:
    """
    Menyamarkan API Key atau nilai rahasia agar aman ditampilkan di log/UI.
    Contoh: 'sk-1234567890abcdef' -> 'sk-1***********cdef'
    """
    if value is None:
        return ""

    secret = str(value).strip()
    if not secret:
        return ""

    if len(secret) <= (visible_start + visible_end):
        return "*" * max(4, len(secret))

    masked_len = len(secret) - visible_start - visible_end
    return f"{secret[:visible_start]}{'*' * masked_len}{secret[-visible_end:]}"


def sanitize_filename(filename: str, default_name: str = "file") -> str:
    """
    Membersihkan nama file untuk mencegah Path Traversal dan karakter berbahaya.
    Menggunakan os.path.basename + regex whitelist.
    Contoh: '../../etc/passwd' -> 'passwd'
    """
    if not filename:
        return default_name

    # Normalisasi backslash Windows agar os.path.basename bekerja konsisten di semua OS
    normalized = str(filename).replace("\\", "/")
    base = os.path.basename(normalized).strip()

    # Hanya izinkan huruf, angka, titik, underscore, dan tanda hubung
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)

    # Hilangkan titik/strip di awal agar tidak menjadi file tersembunyi atau '..'
    cleaned = cleaned.lstrip("._-")

    # Cegah urutan titik ganda (..)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)

    if not cleaned or cleaned in {".", ".."}:
        return default_name

    return cleaned


def sanitize_csv_cell(value: Any) -> str:
    """
    Mencegah CSV Formula Injection (Excel/LibreOffice/Google Sheets)
    dengan menambahkan tanda petik tunggal (') jika nilai diawali karakter formula.
    """
    if value is None:
        return ""

    text = str(value)
    formula_prefixes = ("=", "+", "-", "@", "\t", "\r")

    # Cek baik karakter pertama langsung maupun setelah spasi awal
    if text.startswith(formula_prefixes) or text.lstrip(" ").startswith(formula_prefixes):
        return f"'{text}"

    return text