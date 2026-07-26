"""Klasör tarama işleri."""

from __future__ import annotations

import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from urllib.parse import quote

from . import media_store
from .gps import read_gps

PHOTO_EXT = {
    "jpg", "jpeg", "jpe", "png", "webp", "heic", "heif", "tif", "tiff",
    "dng", "gpr", "arw", "cr2", "cr3", "nef", "nrw", "orf", "raf", "rw2",
    "pef", "srw", "x3f", "avif", "gif", "bmp",
}
VIDEO_EXT = {
    "mp4", "mov", "m4v", "avi", "mkv", "webm", "360", "insv", "ts", "mts",
    "m2ts", "3gp", "3g2", "wmv", "mpg", "mpeg",
}
SKIP_DIRS = {
    "$recycle.bin", "system volume information", "windows", "program files",
    "programdata", ".git", "node_modules", "recovery", "__macosx",
}
GOPRO_NAME = re.compile(r"^(gopr|g[xhs]\d{6}|gpfr|gp\d{6}|go\d{6})", re.I)
DJI_NAME = re.compile(r"^DJI[_-]", re.I)

jobs: dict[str, dict] = {}


def kind_for(name: str) -> str | None:
    ext = Path(name).suffix[1:].lower()
    stem = Path(name).stem
    if ext in PHOTO_EXT:
        return "photo"
    if ext not in VIDEO_EXT:
        return None
    if DJI_NAME.match(stem):
        return "drone"
    if GOPRO_NAME.match(stem):
        return "gopro"
    return "video"


def walk_media(root: Path) -> list[Path]:
    files: list[Path] = []

    def walk(dir_path: Path) -> None:
        try:
            entries = list(dir_path.iterdir())
        except OSError:
            return
        for entry in entries:
            name = entry.name
            if entry.is_dir():
                if name.startswith(".") or name.lower() in SKIP_DIRS:
                    continue
                walk(entry)
            elif entry.is_file() and kind_for(name):
                files.append(entry)

    walk(root)
    # LRV: düşük çözünürlüklü proxy — hiç indeksleme
    return [p for p in files if p.suffix.lower() != ".lrv"]


def _priority(path: Path) -> int:
    kind = kind_for(path.name) or "video"
    return {"gopro": 0, "drone": 1, "photo": 2}.get(kind, 3)


def start_scan(root_path: str, source_id: str) -> str:
    job_id = f"{source_id}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
    job = {
        "phase": "discovering",
        "total": 0,
        "processed": 0,
        "located": 0,
        "missing": 0,
        "items": [],
        "done": False,
        "error": None,
    }
    jobs[job_id] = job

    def run() -> None:
        try:
            root = Path(root_path).resolve()
            files = walk_media(root)
            files.sort(key=_priority)
            job["total"] = len(files)
            job["phase"] = "scanning"
            lock = threading.Lock()

            def handle(path: Path) -> None:
                kind = kind_for(path.name) or "video"
                try:
                    info = path.stat()
                    point = read_gps(path, kind)
                except OSError as exc:
                    with lock:
                        job["processed"] += 1
                        job["missing"] += 1
                        job["error"] = str(exc)
                    return

                rel = path.relative_to(root).as_posix()
                media_id = f"{source_id}|{rel}|{info.st_size}|{int(info.st_mtime * 1000)}"
                media_store.set_path(media_id, path)
                taken = None
                if point and point.get("takenAt"):
                    taken = point["takenAt"]
                    if isinstance(taken, datetime):
                        taken = taken.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                else:
                    taken = datetime.fromtimestamp(info.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")

                item = {
                    "id": media_id,
                    "name": path.name,
                    "relativePath": rel,
                    "sourceId": source_id,
                    "kind": kind,
                    "available": True,
                    "latitude": (point or {}).get("latitude") or 0,
                    "longitude": (point or {}).get("longitude") or 0,
                    "locationMissing": point is None,
                    "takenAt": taken,
                    "url": f"/api/media/{quote(media_id, safe='')}",
                }
                with lock:
                    job["processed"] += 1
                    if point:
                        job["located"] += 1
                    else:
                        job["missing"] += 1
                    job["items"].append(item)

            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(handle, files))
            job["phase"] = "done"
            job["done"] = True
        except Exception as exc:  # noqa: BLE001
            job["error"] = str(exc)
            job["phase"] = "error"
            job["done"] = True

    threading.Thread(target=run, daemon=True).start()
    return job_id
