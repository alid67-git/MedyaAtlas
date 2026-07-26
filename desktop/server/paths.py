"""MedyaAtlas masaüstü — yol çözümleme (Node server ile aynı kurallar)."""

from __future__ import annotations

import os
from pathlib import Path, PureWindowsPath


def path_under_root(candidate: Path, root: Path) -> bool:
    try:
        left = candidate.resolve()
        right = root.resolve()
    except OSError:
        return False
    norm_root = str(right).rstrip("\\/")
    a = str(left).lower()
    b = norm_root.lower()
    return a == b or a.startswith(b + os.sep.lower()) or a.startswith(b + "\\")


def candidate_paths(root_path: str, relative_path: str) -> list[Path]:
    if not root_path or relative_path is None or relative_path == "":
        return []
    root = Path(root_path)
    try:
        normalized_root = root.resolve()
    except OSError:
        normalized_root = root
    raw = str(relative_path).strip()
    ordered: list[Path] = []

    def push(path: Path) -> None:
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if not path_under_root(resolved, normalized_root):
            return
        key = str(resolved).lower()
        if any(str(x).lower() == key for x in ordered):
            return
        ordered.append(resolved)

    if len(raw) >= 2 and raw[1] == ":" or raw.startswith("\\\\"):
        push(Path(raw))

    rel = raw.replace("\\", "/").lstrip("/")
    if rel:
        push(normalized_root / PureWindowsPath(rel))

    root_name = normalized_root.name
    if root_name and rel.lower().startswith(root_name.lower() + "/"):
        push(normalized_root / PureWindowsPath(rel[len(root_name) + 1 :]))

    if not (len(raw) >= 2 and raw[1] == ":") and not raw.startswith("\\\\"):
        base = Path(rel).name if rel else ""
        if base:
            push(normalized_root / base)

    return ordered


def resolve_existing(root_path: str | None, relative_path: str | None) -> Path | None:
    if not root_path or relative_path is None:
        return None
    for candidate in candidate_paths(root_path, relative_path):
        if candidate.is_file():
            return candidate
    return None
