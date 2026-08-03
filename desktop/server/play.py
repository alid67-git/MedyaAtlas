"""Sistem / VLC / Windows Media Player ile video açma."""

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


def _find_wmplayer() -> str | None:
    if sys.platform != "win32":
        return None
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Windows Media Player"
        / "wmplayer.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Windows Media Player"
        / "wmplayer.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None


def players_available() -> dict:
    return {
        "vlc": bool(_find_vlc()),
        "wmplayer": bool(_find_wmplayer()),
        "system": True,
    }


def play_file(path: Path, prefer: str | None = None) -> dict:
    """
    Dosyayı oynatır.
    prefer: system | vlc | wmplayer
    Varsayılan: Windows ilişkilendirmesi / startfile.
    """
    if not path.is_file():
        return {"ok": False, "error": "Dosya bulunamadı."}

    prefer = (prefer or os.environ.get("MEDIAATLAS_PLAYER") or "system").lower()
    creation = 0
    if sys.platform == "win32":
        creation = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    if prefer == "vlc":
        exe = _find_vlc()
        if not exe:
            return {
                "ok": False,
                "error": "VLC bulunamadı. Kuruluysa PATH’e ekleyin veya VLC_PATH ortam değişkenini ayarlayın.",
            }
        subprocess.Popen(
            [exe, "--started-from-file", str(path)],
            close_fds=True,
            creationflags=creation,
        )
        return {"ok": True, "engine": "vlc", "path": str(path)}

    if prefer in ("wmplayer", "wmp", "mediaplayer"):
        exe = _find_wmplayer()
        if exe:
            subprocess.Popen(
                [exe, str(path)],
                close_fds=True,
                creationflags=creation,
            )
            return {"ok": True, "engine": "wmplayer", "path": str(path)}
        prefer = "system"

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
