import os
import secrets
from typing import Any, Dict, Optional
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory, session

from core.security import require_api_security, sanitize_filename
from routes.ai_snapshot import ai_snapshot_bp

# Muat variabel lingkungan dari file .env
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def create_app(config_override: Optional[Dict[str, Any]] = None) -> Flask:
    """
    Application Factory Flask untuk Suco+.
    Menstandardisasi konfigurasi, context processor, blueprint, dan error handlers
    agar siap dijalankan di environment lokal maupun cPanel Phusion Passenger.
    """
    app = Flask(
        __name__,
        template_folder=os.path.join(BASE_DIR, "templates"),
        static_folder=os.path.join(BASE_DIR, "static"),
    )

    # Konfigurasi Kunci Sesi & Keamanan Cookie
    secret_key = (
        os.getenv("FLASK_SECRET_KEY")
        or os.getenv("SECRET_KEY")
        or secrets.token_hex(32)
    )
    app.config["SECRET_KEY"] = secret_key
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    # Konfigurasi Folder Runtime
    app.config["UPLOAD_FOLDER"] = os.path.join(BASE_DIR, "uploads", "snapshots")
    app.config["TMP_FOLDER"] = os.path.join(BASE_DIR, "tmp")

    # Terapkan override konfigurasi jika ada (misal untuk testing)
    if config_override:
        app.config.update(config_override)

    # Pastikan folder runtime fisik tersedia
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    os.makedirs(app.config["TMP_FOLDER"], exist_ok=True)

    # Registrasi Blueprint
    app.register_blueprint(ai_snapshot_bp)

    def get_base_path() -> str:
        """Mengembalikan script_root tanpa trailing slash agar aman di subfolder hosting cPanel."""
        return request.script_root.rstrip("/")

    def get_csrf_token() -> str:
        """Membuat atau mengambil CSRF token yang tersimpan di session."""
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_hex(32)
        return session["csrf_token"]

    def asset_url(filepath: str) -> str:
        """
        Helper cache-busting untuk file statis.
        Menyertakan base_path dan parameter query versi (?v=<mtime>).
        Contoh pemakaian di Jinja template: {{ asset_url('assets/js/camera.js') }}
        """
        clean_path = filepath.lstrip("/")
        base_path = get_base_path()
        full_file_path = os.path.join(app.static_folder, clean_path)

        version = "1"
        if os.path.isfile(full_file_path):
            try:
                version = str(int(os.path.getmtime(full_file_path)))
            except OSError:
                version = "1"

        return f"{base_path}/static/{clean_path}?v={version}"

    @app.context_processor
    def inject_globals():
        """Menyuntikkan variabel global ke seluruh template HTML."""
        return {
            "base_path": get_base_path(),
            "csrf_token": get_csrf_token(),
            "asset_url": asset_url,
        }

    @app.route("/")
    def index():
        """Halaman utama Suco+ (Kamera Live & Deteksi Objek)."""
        return render_template("index.html")

    @app.route("/health")
    def health():
        """Endpoint status server Suco+."""
        return jsonify({
            "status": "ok",
            "app": "Suco+",
            "routes": {
                "snapshot_save": "/api/snapshot/save",
                "ai_analyze": "/api/ai/analyze",
            },
        })

    @app.route("/api/ping-secure", methods=["POST"])
    @require_api_security(max_requests=30, window_seconds=60)
    def api_ping_secure():
        """Endpoint tes keamanan CSRF dan Rate Limiter."""
        return jsonify({"status": "ok", "message": "Keamanan API terverifikasi!"})

    @app.route("/uploads/snapshots/<path:filename>")
    def serve_snapshot(filename: str):
        """
        Menyajikan file snapshot tersimpan secara aman dengan pencegahan path traversal.
        """
        safe_name = sanitize_filename(filename)
        return send_from_directory(app.config["UPLOAD_FOLDER"], safe_name)

    @app.errorhandler(404)
    def handle_not_found(error):
        """Handler untuk rute yang tidak ditemukan."""
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": "Endpoint API tidak ditemukan."}), 404
        return render_template("index.html"), 404

    @app.errorhandler(500)
    def handle_server_error(error):
        """Handler untuk error internal server."""
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": "Terjadi kesalahan internal server."}), 500
        return jsonify({"status": "error", "message": "Internal Server Error"}), 500

    return app


# Instance global untuk server WSGI (cPanel Phusion Passenger: passenger_wsgi.py)
app = create_app()

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)
