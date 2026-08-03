#!/usr/bin/env python3
"""JSONL konum işçisi — video daki konum neresi / location_extractor.

Önce kardeş projedeki dosyayı yükler; yoksa MedyaAtlas kopyasını kullanır.

stdin satırları:
  {"id":"...","path":"...","mode":"fast|deep|full","force":false}
  {"id":"...","op":"flush"}
  {"id":"...","op":"list","path":"...","recursive":true,"include_insv":false}

stdout:
  {"id":"...","ok":true,"has_location":bool,"needs_deep":bool,...}
  {"ready":true,"source_dir":"...","backends":{...}}
"""

from __future__ import annotations

import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Windows cp1252/charmap: Türkçe yol (ş/ç + combining) stdout'ta patlamasın
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="surrogateescape")  # type: ignore[attr-defined]
    sys.stdin.reconfigure(encoding="utf-8", errors="surrogateescape")  # type: ignore[attr-defined]
except Exception:
    pass

HERE = Path(__file__).resolve().parent
# .../MedyaAtlas/desktop/server → .../Ali Dinçer Projeler/video daki konum neresi
SIBLING_EXTRACTOR_DIR = HERE.parents[2] / "video daki konum neresi"

_SOURCE_DIR = HERE
for candidate in (SIBLING_EXTRACTOR_DIR, HERE):
    if (candidate / "location_extractor.py").is_file():
        sys.path.insert(0, str(candidate))
        _SOURCE_DIR = candidate
        break

import location_extractor as extractor  # noqa: E402

# list_media_files kuralları (app.py ile aynı)
SKIP_DIR_NAMES = {
    "$recycle.bin",
    "recycle.bin",
    "system volume information",
    "windows",
    "program files",
    "programdata",
    ".git",
    "node_modules",
    ".trash",
    ".trashes",
    "#recycle",
    "@eadir",
    ".spotlight-v100",
    ".fseventsd",
    ".temporaryitems",
    "found.000",
    "found.001",
}
MIN_MEDIA_BYTES = 100_000

WORKERS = 8
_write_lock = threading.Lock()


def _write(out: dict) -> None:
    """JSONL satırı — her zaman UTF-8 bayt; charmap kullanma."""
    line = json.dumps(out, ensure_ascii=False) + "\n"
    data = line.encode("utf-8", errors="surrogatepass")
    with _write_lock:
        buf = getattr(sys.stdout, "buffer", None)
        if buf is not None:
            buf.write(data)
            buf.flush()
        else:
            sys.stdout.write(line)
            sys.stdout.flush()


def _invalidate_cached_result(path: str) -> None:
    """Zorunlu yeniden okumada önceki miss/hit önbelleğini at."""
    try:
        file_path = Path(path)
        key = extractor._cache_key(file_path)
        store = extractor._cache_load()
        with extractor._cache_lock:
            store.pop(key, None)
    except (AttributeError, OSError):
        pass


def _list_media_files(
    folder: Path,
    recursive: bool = True,
    include_insv: bool = False,
) -> list[str]:
    root = str(folder)
    files: list[str] = []
    all_ext = getattr(extractor, "ALL_EXTENSIONS", set())

    def want(name: str, ext: str) -> bool:
        if name.startswith("._") or name.startswith("."):
            return False
        if ext not in all_ext:
            return False
        if ext == ".lrv":
            return False
        if ext == ".insv":
            if not include_insv:
                return False
            if "_10_" in name.upper():
                return False
        return True

    def prune(dirnames: list[str]) -> None:
        dirnames[:] = [
            d
            for d in dirnames
            if d.lower() not in SKIP_DIR_NAMES
            and not d.upper().startswith("$RECYCLE")
            and not d.startswith(".")
        ]

    if not recursive:
        try:
            with os.scandir(root) as it:
                for entry in it:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    ext = os.path.splitext(entry.name)[1].lower()
                    if not want(entry.name, ext):
                        continue
                    try:
                        if entry.stat(follow_symlinks=False).st_size < MIN_MEDIA_BYTES:
                            continue
                    except OSError:
                        continue
                    files.append(os.path.join(root, entry.name))
        except OSError:
            pass
        return sorted(files, key=lambda p: p.lower())

    try:
        for dirpath, dirnames, filenames in os.walk(
            root, topdown=True, followlinks=False
        ):
            prune(dirnames)
            for name in filenames:
                ext = os.path.splitext(name)[1].lower()
                if not want(name, ext):
                    continue
                full = os.path.join(dirpath, name)
                try:
                    if os.path.getsize(full) < MIN_MEDIA_BYTES:
                        continue
                except OSError:
                    continue
                files.append(full)
    except OSError:
        pass
    return sorted(files, key=lambda p: p.lower())


def _process(req: dict) -> None:
    req_id = req.get("id")
    op = (req.get("op") or "extract").strip().lower()

    if op == "flush":
        try:
            extractor.cache_flush()
            _write({"id": req_id, "ok": True, "flushed": True})
        except Exception as exc:  # noqa: BLE001
            _write({"id": req_id, "ok": False, "error": str(exc)})
        return

    if op == "list":
        path = req.get("path")
        if not path:
            _write({"id": req_id, "ok": False, "error": "path_required"})
            return
        try:
            paths = _list_media_files(
                Path(path),
                recursive=bool(req.get("recursive", True)),
                include_insv=bool(req.get("include_insv", False)),
            )
            _write({"id": req_id, "ok": True, "paths": paths, "total": len(paths)})
        except Exception as exc:  # noqa: BLE001
            _write({"id": req_id, "ok": False, "error": str(exc)})
        return

    path = req.get("path")
    if not path:
        _write({"id": req_id, "ok": False, "error": "path_required"})
        return

    mode = str(req.get("mode") or "full").lower().strip()
    if mode not in {"fast", "deep", "full"}:
        mode = "full"

    try:
        if req.get("force"):
            _invalidate_cached_result(path)
        result = extractor.extract_location(path, mode=mode)
        needs_deep = bool((result.extra or {}).get("needs_deep", False))
        out = {
            "id": req_id,
            "ok": True,
            "has_location": bool(result.has_location),
            "latitude": result.latitude,
            "longitude": result.longitude,
            "altitude": result.altitude,
            "source": result.source,
            "media_type": result.media_type,
            "error": result.error,
            "needs_deep": needs_deep,
            "mode": mode,
        }
    except Exception as exc:  # noqa: BLE001
        out = {
            "id": req_id,
            "ok": False,
            "has_location": False,
            "needs_deep": False,
            "error": str(exc),
        }
    _write(out)


def main() -> None:
    sibling = (SIBLING_EXTRACTOR_DIR / "location_extractor.py").is_file()
    _write(
        {
            "ready": True,
            "extractor": "location_extractor",
            "source_dir": str(_SOURCE_DIR),
            "sibling": sibling,
            "backends": extractor.available_backends(),
            "workers": WORKERS,
        }
    )

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                _write({"ok": False, "error": "invalid_json"})
                continue
            pool.submit(_process, req)


if __name__ == "__main__":
    main()
