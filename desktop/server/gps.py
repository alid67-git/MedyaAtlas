"""Fotoğraf/video GPS — birebir Konum Bulucu location_extractor."""

from __future__ import annotations

from pathlib import Path

from .location_extractor import extract_location


def _gps(lat: float | None, lon: float | None) -> dict | None:
    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if abs(lat) < 0.01 and abs(lon) < 0.01:
        return None
    return {"latitude": float(lat), "longitude": float(lon)}


def read_gps(path: Path, kind: str) -> dict | None:
    """Tür fark etmeksizin extract_location — video daki konum neresi ile aynı."""
    del kind  # Konum Bulucu tür ayırmaz
    try:
        result = extract_location(path)
    except Exception:
        return None
    if not result or not result.has_location:
        return None
    return _gps(result.latitude, result.longitude)
