"""Fotoğraf EXIF GPS; video için ffprobe / yan SRT (basit)."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

try:
    import piexif
except ImportError:  # pragma: no cover
    piexif = None  # type: ignore


def _gps(lat: float | None, lon: float | None) -> dict | None:
    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if abs(lat) < 0.01 and abs(lon) < 0.01:
        return None
    return {"latitude": float(lat), "longitude": float(lon)}


def _dms_to_deg(values, ref: str | None) -> float | None:
    try:
        d, m, s = values
        deg = float(d) + float(m) / 60.0 + float(s) / 3600.0
        if ref in ("S", "W"):
            deg = -deg
        return deg
    except Exception:
        return None


def read_photo_gps(path: Path) -> dict | None:
    try:
        img = Image.open(path)
        exif = img._getexif() or {}
    except Exception:
        exif = {}

    gps_info = {}
    for tag, value in exif.items():
        name = TAGS.get(tag, tag)
        if name == "GPSInfo":
            for t, v in value.items():
                gps_info[GPSTAGS.get(t, t)] = v

    if gps_info:
        lat = _dms_to_deg(gps_info.get("GPSLatitude"), gps_info.get("GPSLatitudeRef"))
        lon = _dms_to_deg(gps_info.get("GPSLongitude"), gps_info.get("GPSLongitudeRef"))
        point = _gps(lat, lon)
        if point:
            taken = None
            for key in ("DateTimeOriginal", "DateTime"):
                raw = exif.get(next((t for t, n in TAGS.items() if n == key), None))
                if isinstance(raw, str):
                    try:
                        taken = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S").replace(
                            tzinfo=timezone.utc
                        )
                    except ValueError:
                        pass
            if taken:
                point["takenAt"] = taken
            return point

    if piexif:
        try:
            data = piexif.load(str(path))
            g = data.get("GPS") or {}
            if g:
                lat = _dms_to_deg(g.get(piexif.GPSIFD.GPSLatitude), (g.get(piexif.GPSIFD.GPSLatitudeRef) or b"N").decode())
                lon = _dms_to_deg(g.get(piexif.GPSIFD.GPSLongitude), (g.get(piexif.GPSIFD.GPSLongitudeRef) or b"E").decode())
                return _gps(lat, lon)
        except Exception:
            pass
    return None


def read_srt_gps(video: Path) -> dict | None:
    for cand in (
        video.with_suffix(".SRT"),
        video.with_suffix(".srt"),
        video.with_name(video.stem + ".SRT"),
    ):
        if not cand.is_file():
            continue
        try:
            text = cand.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        named = re.search(
            r"(?:latitude|lat)\s*[:=]\s*([+-]?\d{1,2}(?:\.\d+)?)[\s\S]{0,160}?"
            r"(?:longitude|long|lon)\s*[:=]\s*([+-]?\d{1,3}(?:\.\d+)?)",
            text,
            re.I,
        )
        if named:
            return _gps(float(named.group(1)), float(named.group(2)))
        iso = re.search(
            r"([+-]\d{1,2}\.\d{4,})([+-]\d{1,3}\.\d{4,})(?:[+-]\d+(?:\.\d+)?)?/",
            text,
        )
        if iso:
            return _gps(float(iso.group(1)), float(iso.group(2)))
    return None


def read_ffprobe_gps(path: Path) -> dict | None:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout or "{}")
        tags = (data.get("format") or {}).get("tags") or {}
        loc = tags.get("location") or tags.get("com.apple.quicktime.location.ISO6709") or ""
        m = re.search(r"([+-]\d+\.\d+)([+-]\d+\.\d+)", str(loc))
        if m:
            return _gps(float(m.group(1)), float(m.group(2)))
    except Exception:
        return None
    return None


def read_gps(path: Path, kind: str) -> dict | None:
    if kind == "photo":
        return read_photo_gps(path)
    point = read_srt_gps(path) or read_ffprobe_gps(path)
    return point
