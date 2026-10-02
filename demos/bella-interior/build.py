"""Inline fonts, logo and photos into one self-contained HTML file.

Usage: python3 build.py
Reads src/index.html and writes bella-interior.html next to this script.
Any `asset:<file>` reference in the source is replaced with a base64 data URL
for src/assets/<file>, so the result opens offline (e.g. from Files in Safari).
"""
import base64
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src" / "index.html"
ASSETS = ROOT / "src" / "assets"
OUT = ROOT / "bella-interior.html"

TYPES = {".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def data_url(name: str) -> str:
    path = ASSETS / name
    mime = TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0]
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


html = SRC.read_text(encoding="utf-8")
html = re.sub(r"asset:([\w.\-]+)", lambda m: data_url(m.group(1)), html)
OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT.name} ({OUT.stat().st_size / 1024:.0f} KB)")
