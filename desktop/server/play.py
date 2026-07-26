"""Sistem oynatıcı ile video açma (VLC zorunlu değil)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_vlc() -> str | None:
    env = os.environ.get("VLC_PATH")
    if env and Path(env).is_file():
        return env
    which = shutil.which("vlc")
    if which:
        return which
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "VideoLAN" / "VLC" / "vlc.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "VideoLAN" / "VLC" / "vlc.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None


def play_file(path: Path, prefer: str | None = None) -> dict:
    """
    Dosyayı oynatır.
    Varsayılan: Windows ilişkilendirmesi (Movies & TV / Fotoğraflar / ne kuruluysa).
    prefer=vlc ise VLC dener; yoksa yine sisteme düşer.
    """
    if not path.is_file():
        return {"ok": False, "error": "Dosya bulunamadı."}

    prefer = (prefer or os.environ.get("MEDIAATLAS_PLAYER") or "system").lower()

    if prefer == "vlc":
        exe = _find_vlc()
        if not exe:
            return {
                "ok": False,
                "error": "VLC bulunamadı. Kuruluysa PATH’e ekleyin veya VLC_PATH ortam değişkenini ayarlayın.",
            }
        creation = 0
        if sys.platform == "win32":
            creation = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        subprocess.Popen(
            [exe, "--started-from-file", str(path)],
            close_fds=True,
            creationflags=creation,
        )
        return {"ok": True, "engine": "vlc", "path": str(path)}

    # Windows: varsayılan uygulama (kurulum gerekmez)
    if sys.platform == "win32":
        try:
            os.startfile(str(path))  # type: ignore[attr-defined]
            return {"ok": True, "engine": "system", "path": str(path)}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    opener = shutil.which("xdg-open") or shutil.which("open")
    if not opener:
        return {"ok": False, "error": "Sistem oynatıcı bulunamadı."}
    subprocess.Popen([opener, str(path)], close_fds=True)
    return {"ok": True, "engine": "system", "path": str(path)}
