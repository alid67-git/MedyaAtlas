"""Kaynak + kütüphane diske (IndexedDB silinse bile kalır)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    root = Path(base) if base else Path.home() / ".medyaatlas"
    path = root / "MedyaAtlas"
    path.mkdir(parents=True, exist_ok=True)
    return path


def state_path() -> Path:
    return data_dir() / "library-state.json"


def webview_storage_path() -> Path:
    path = data_dir() / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_state() -> dict[str, Any]:
    path = state_path()
    if not path.is_file():
        return {"sources": [], "items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"sources": [], "items": []}
    sources = data.get("sources") if isinstance(data, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    return {
        "sources": sources if isinstance(sources, list) else [],
        "items": items if isinstance(items, list) else [],
    }


def save_state(sources: list[Any], items: list[Any]) -> dict[str, Any]:
    path = state_path()
    payload = {
        "version": 1,
        "sources": sources,
        "items": items,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
    return {"ok": True, "path": str(path), "sources": len(sources), "items": len(items)}
