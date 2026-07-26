"""Medya kimliği → dosya yolu deposu."""

from __future__ import annotations

from pathlib import Path

_media: dict[str, Path] = {}


def set_path(media_id: str, path: Path) -> None:
    _media[media_id] = path


def get_path(media_id: str) -> Path | None:
    return _media.get(media_id)


def clear() -> None:
    _media.clear()
