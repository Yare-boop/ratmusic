#!/usr/bin/env python3
"""
RatMusic Server 🐀
Servidor local para descargar audio desde YouTube vía yt-dlp.
Corre en Termux en tu Android — escucha en localhost:5000.

Instalación en Termux:
  pkg install python yt-dlp ffmpeg
  pip install flask flask-cors
  termux-setup-storage
  python ~/ratmusic-server.py
"""

import os
import re
import json
import logging
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    import yt_dlp
except ImportError:
    print("ERROR: yt_dlp no instalado. Ejecuta: pip install yt-dlp")
    exit(1)

# ── Config ────────────────────────────────────────────────
HOST        = "127.0.0.1"   # solo accesible desde el mismo dispositivo
PORT        = 5000
DOWNLOAD_DIR = Path(os.path.expanduser("~/storage/music/RatMusic"))
LOG_FILE     = Path(os.path.expanduser("~/ratmusic-server.log"))

# Crear directorio de descarga si no existe
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [🐀] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE),
    ]
)
log = logging.getLogger("ratmusic")

# ── Flask app ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins=["*"])   # permitir PWA local

# ── Utilidades ────────────────────────────────────────────

VALID_FORMATS = {"mp3", "m4a", "opus", "flac"}
URL_PATTERN   = re.compile(
    r"(https?://)?(www\.)?"
    r"(youtube\.com|youtu\.be|music\.youtube\.com)"
    r"/.+"
)

def sanitize_url(url: str) -> str | None:
    url = url.strip()
    if URL_PATTERN.match(url):
        return url
    return None

def get_ydl_opts(fmt: str, output_dir: Path) -> dict:
    """Opciones para yt-dlp según formato."""
    base = {
        "outtmpl"         : str(output_dir / "%(title)s.%(ext)s"),
        "quiet"           : True,
        "no_warnings"     : True,
        "extract_flat"    : False,
        "ignoreerrors"    : False,
        "socket_timeout"  : 30,
        "retries"         : 3,
        # Cookies / autenticación (opcional, descomenta si YouTube bloquea)
        # "cookiefile": str(Path.home() / "cookies.txt"),
    }

    if fmt == "mp3":
        base["format"] = "bestaudio/best"
        base["postprocessors"] = [{
            "key"            : "FFmpegExtractAudio",
            "preferredcodec" : "mp3",
            "preferredquality": "192",
        }]
    elif fmt == "m4a":
        base["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        base["postprocessors"] = [{
            "key"            : "FFmpegExtractAudio",
            "preferredcodec" : "m4a",
        }]
    elif fmt == "opus":
        base["format"] = "bestaudio[ext=webm]/bestaudio/best"
        base["postprocessors"] = [{
            "key"            : "FFmpegExtractAudio",
            "preferredcodec" : "opus",
        }]
    elif fmt == "flac":
        base["format"] = "bestaudio/best"
        base["postprocessors"] = [{
            "key"            : "FFmpegExtractAudio",
            "preferredcodec" : "flac",
        }]

    return base

# ── Rutas ─────────────────────────────────────────────────

@app.route("/ping")
def ping():
    """Health-check — la PWA lo usa para saber si el servidor está vivo."""
    return jsonify({"status": "ok", "app": "RatMusic", "version": "1.0.0"})


@app.route("/download")
def download():
    """Descarga audio desde YouTube y lo guarda en ~/storage/music/RatMusic."""
    url = request.args.get("url", "").strip()
    fmt = request.args.get("format", "mp3").lower()

    # Validaciones
    if not url:
        return jsonify({"error": "Falta el parámetro 'url'"}), 400

    clean_url = sanitize_url(url)
    if not clean_url:
        return jsonify({"error": "URL inválida — solo se permiten URLs de YouTube"}), 400

    if fmt not in VALID_FORMATS:
        return jsonify({"error": f"Formato '{fmt}' no válido. Usa: {', '.join(VALID_FORMATS)}"}), 400

    log.info(f"Descargando: {clean_url} [{fmt}]")

    try:
        opts = get_ydl_opts(fmt, DOWNLOAD_DIR)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(clean_url, download=True)

        title = info.get("title", "Canción desconocida")
        log.info(f"✅ Descargado: {title}")

        return jsonify({
            "status" : "ok",
            "title"  : title,
            "format" : fmt,
            "folder" : str(DOWNLOAD_DIR),
        })

    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        log.error(f"yt-dlp error: {msg}")
        if "private video" in msg.lower():
            return jsonify({"error": "Video privado — no se puede descargar"}), 403
        if "copyright" in msg.lower():
            return jsonify({"error": "Video bloqueado por derechos de autor en tu región"}), 403
        return jsonify({"error": f"Error de descarga: {msg[:200]}"}), 500

    except Exception as e:
        log.exception("Error inesperado")
        return jsonify({"error": f"Error interno: {str(e)[:200]}"}), 500


@app.route("/songs")
def list_songs():
    """Lista los archivos de audio descargados."""
    try:
        exts = {".mp3", ".m4a", ".opus", ".flac", ".ogg", ".wav"}
        files = [
            {
                "name"   : f.name,
                "stem"   : f.stem,
                "size"   : f.stat().st_size,
                "format" : f.suffix.lstrip("."),
                "path"   : str(f),
            }
            for f in DOWNLOAD_DIR.iterdir()
            if f.suffix.lower() in exts and f.is_file()
        ]
        files.sort(key=lambda x: x["name"].lower())
        return jsonify({"status": "ok", "songs": files, "total": len(files)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/delete", methods=["DELETE"])
def delete_song():
    """Elimina un archivo por nombre (solo dentro de DOWNLOAD_DIR)."""
    name = request.args.get("name", "").strip()
    if not name or "/" in name or "\\" in name or ".." in name:
        return jsonify({"error": "Nombre de archivo inválido"}), 400

    target = DOWNLOAD_DIR / name
    if not target.exists():
        return jsonify({"error": "Archivo no encontrado"}), 404

    # Seguridad: asegurarse de que está dentro de DOWNLOAD_DIR
    try:
        target.resolve().relative_to(DOWNLOAD_DIR.resolve())
    except ValueError:
        return jsonify({"error": "Ruta fuera del directorio permitido"}), 403

    target.unlink()
    log.info(f"Eliminado: {name}")
    return jsonify({"status": "ok", "deleted": name})


# ── Entry point ───────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════╗
║   🐀  RatMusic Server v1.0.0             ║
║   http://{HOST}:{PORT}                     ║
║   Carpeta: {str(DOWNLOAD_DIR)[:30]}  ║
╚══════════════════════════════════════════╝
Ctrl+C para detener
""")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
