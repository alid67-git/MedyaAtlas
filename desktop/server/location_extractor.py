"""Extract GPS / location metadata from images and videos."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Image extensions Pillow / pillow-heif can handle or that often carry EXIF
IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
    ".heic",
    ".heif",
    ".bmp",
    ".gif",
    ".dng",
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".orf",
    ".rw2",
    ".raf",
    ".srw",
}

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".3gp",
    ".3g2",
    ".mts",
    ".m2ts",
    ".wmv",
    ".flv",
    ".mpg",
    ".mpeg",
    ".ts",
}

ALL_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

ISO6709_RE = re.compile(
    r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/?$"
)


@dataclass
class LocationResult:
    path: str
    has_location: bool
    latitude: float | None = None
    longitude: float | None = None
    altitude: float | None = None
    source: str | None = None
    media_type: str | None = None
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "has_location": self.has_location,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "altitude": self.altitude,
            "source": self.source,
            "media_type": self.media_type,
            "error": self.error,
            "extra": self.extra,
        }


def _dms_to_decimal(dms: tuple, ref: str) -> float:
    """Convert EXIF DMS (degrees, minutes, seconds) to decimal degrees."""
    degrees, minutes, seconds = (float(x) for x in dms)
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _parse_iso6709(value: str) -> tuple[float, float, float | None] | None:
    """Parse ISO 6709 strings like +37.7749-122.4194+10/ or +37.77-122.41/."""
    text = value.strip()
    match = ISO6709_RE.match(text)
    if not match:
        return None
    lat = float(match.group(1))
    lon = float(match.group(2))
    alt = float(match.group(3)) if match.group(3) else None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon, alt


def _looks_like_coord_pair(tags: dict[str, Any]) -> tuple[float, float] | None:
    """Try common latitude/longitude tag name pairs."""
    lat_keys = (
        "location-lat",
        "location_latitude",
        "com.apple.quicktime.location.latitude",
        "latitude",
        "gpslatitude",
        "lat",
        "y",
    )
    lon_keys = (
        "location-lon",
        "location_longitude",
        "com.apple.quicktime.location.longitude",
        "longitude",
        "gpslongitude",
        "lon",
        "lng",
        "x",
    )

    lower = {str(k).lower(): v for k, v in tags.items()}
    lat = lon = None
    for key in lat_keys:
        if key in lower and lower[key] not in (None, ""):
            try:
                lat = float(str(lower[key]).replace(",", "."))
                break
            except ValueError:
                continue
    for key in lon_keys:
        if key in lower and lower[key] not in (None, ""):
            try:
                lon = float(str(lower[key]).replace(",", "."))
                break
            except ValueError:
                continue
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        return lat, lon
    return None


def _scan_tags_for_iso6709(tags: dict[str, Any]) -> tuple[float, float, float | None] | None:
    for key, value in tags.items():
        key_l = str(key).lower()
        if "iso6709" in key_l or "location" in key_l or "xyz" in key_l or "gps" in key_l:
            if isinstance(value, str):
                parsed = _parse_iso6709(value)
                if parsed:
                    return parsed
            # Sometimes nested as list/tuple
            if isinstance(value, (list, tuple)) and len(value) >= 2:
                try:
                    lat, lon = float(value[0]), float(value[1])
                    alt = float(value[2]) if len(value) > 2 else None
                    if -90 <= lat <= 90 and -180 <= lon <= 180:
                        return lat, lon, alt
                except (TypeError, ValueError):
                    pass
    return None


def extract_with_exiftool(path: Path) -> LocationResult | None:
    """Best coverage: ExifTool if installed on PATH."""
    exe = shutil.which("exiftool") or shutil.which("exiftool.exe")
    if not exe:
        return None

    try:
        # -fast2: only read first metadata block (enough for GPS tags on most files)
        proc = subprocess.run(
            [
                exe,
                "-n",
                "-fast2",
                "-json",
                "-GPSLatitude",
                "-GPSLongitude",
                "-GPSAltitude",
                "-GPSPosition",
                "-Keys:GPSCoordinates",
                "-ItemList:GPSCoordinates",
                "-UserData:GPSCoordinates",
                "-Location",
                "-LocationShown",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if proc.returncode not in (0, 1) or not proc.stdout.strip():
            return None
        data = json.loads(proc.stdout)
        if not data:
            return None
        meta = data[0]
        lat = meta.get("GPSLatitude")
        lon = meta.get("GPSLongitude")
        alt = meta.get("GPSAltitude")

        if lat is None or lon is None:
            for key in ("GPSCoordinates", "GPSPosition", "Location", "LocationShown"):
                raw = meta.get(key)
                if not raw:
                    continue
                if isinstance(raw, str):
                    # "37.77 -122.41" or ISO6709
                    parsed = _parse_iso6709(raw.replace(" ", ""))
                    if parsed:
                        lat, lon, alt2 = parsed
                        alt = alt if alt is not None else alt2
                        break
                    parts = re.findall(r"[+-]?\d+(?:\.\d+)?", raw)
                    if len(parts) >= 2:
                        lat, lon = float(parts[0]), float(parts[1])
                        if len(parts) >= 3 and alt is None:
                            alt = float(parts[2])
                        break

        if lat is None or lon is None:
            return LocationResult(
                path=str(path),
                has_location=False,
                media_type=_media_type(path),
                source="exiftool",
            )

        return LocationResult(
            path=str(path),
            has_location=True,
            latitude=float(lat),
            longitude=float(lon),
            altitude=float(alt) if alt is not None else None,
            source="exiftool",
            media_type=_media_type(path),
        )
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError, TypeError):
        return None


def extract_from_image_pillow(path: Path) -> LocationResult | None:
    try:
        from PIL import Image, ExifTags
    except ImportError:
        return None

    try:
        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        except ImportError:
            pass

        with Image.open(path) as img:
            exif = img.getexif()
            if not exif:
                return LocationResult(
                    path=str(path),
                    has_location=False,
                    media_type="image",
                    source="pillow",
                )

            gps_ifd = None
            for tag_id, value in exif.items():
                tag = ExifTags.TAGS.get(tag_id, tag_id)
                if tag == "GPSInfo":
                    gps_ifd = value
                    break

            if not gps_ifd:
                # Pillow 8+: get_ifd
                try:
                    gps_ifd = exif.get_ifd(0x8825)
                except Exception:
                    gps_ifd = None

            if not gps_ifd:
                return LocationResult(
                    path=str(path),
                    has_location=False,
                    media_type="image",
                    source="pillow",
                )

            gps = {
                ExifTags.GPSTAGS.get(k, k): v for k, v in dict(gps_ifd).items()
            }
            lat_ref = gps.get("GPSLatitudeRef")
            lon_ref = gps.get("GPSLongitudeRef")
            lat_dms = gps.get("GPSLatitude")
            lon_dms = gps.get("GPSLongitude")
            if not (lat_ref and lon_ref and lat_dms and lon_dms):
                return LocationResult(
                    path=str(path),
                    has_location=False,
                    media_type="image",
                    source="pillow",
                )

            lat = _dms_to_decimal(tuple(lat_dms), str(lat_ref))
            lon = _dms_to_decimal(tuple(lon_dms), str(lon_ref))
            alt = None
            if gps.get("GPSAltitude") is not None:
                try:
                    alt = float(gps["GPSAltitude"])
                    if str(gps.get("GPSAltitudeRef", "0")) in ("1", b"\x01"):
                        alt = -alt
                except (TypeError, ValueError):
                    alt = None

            return LocationResult(
                path=str(path),
                has_location=True,
                latitude=lat,
                longitude=lon,
                altitude=alt,
                source="pillow",
                media_type="image",
            )
    except Exception as exc:
        return LocationResult(
            path=str(path),
            has_location=False,
            media_type="image",
            source="pillow",
            error=str(exc),
        )


def extract_from_image_piexif(path: Path) -> LocationResult | None:
    try:
        import piexif
    except ImportError:
        return None

    try:
        exif_dict = piexif.load(str(path))
        gps = exif_dict.get("GPS") or {}
        if not gps:
            return LocationResult(
                path=str(path),
                has_location=False,
                media_type="image",
                source="piexif",
            )

        def _rational_to_float(val: Any) -> float:
            if isinstance(val, tuple) and len(val) == 2 and val[1]:
                return float(val[0]) / float(val[1])
            return float(val)

        def _dms_from_piexif(dms: Any) -> tuple[float, float, float]:
            return tuple(_rational_to_float(x) for x in dms)  # type: ignore[return-value]

        lat_dms = gps.get(piexif.GPSIFD.GPSLatitude)
        lon_dms = gps.get(piexif.GPSIFD.GPSLongitude)
        lat_ref = gps.get(piexif.GPSIFD.GPSLatitudeRef)
        lon_ref = gps.get(piexif.GPSIFD.GPSLongitudeRef)
        if not (lat_dms and lon_dms and lat_ref and lon_ref):
            return LocationResult(
                path=str(path),
                has_location=False,
                media_type="image",
                source="piexif",
            )

        lat_ref_s = lat_ref.decode() if isinstance(lat_ref, bytes) else str(lat_ref)
        lon_ref_s = lon_ref.decode() if isinstance(lon_ref, bytes) else str(lon_ref)
        lat = _dms_to_decimal(_dms_from_piexif(lat_dms), lat_ref_s)
        lon = _dms_to_decimal(_dms_from_piexif(lon_dms), lon_ref_s)

        alt = None
        if piexif.GPSIFD.GPSAltitude in gps:
            alt = _rational_to_float(gps[piexif.GPSIFD.GPSAltitude])
            ref = gps.get(piexif.GPSIFD.GPSAltitudeRef, 0)
            if ref in (1, b"\x01"):
                alt = -alt

        return LocationResult(
            path=str(path),
            has_location=True,
            latitude=lat,
            longitude=lon,
            altitude=alt,
            source="piexif",
            media_type="image",
        )
    except Exception as exc:
        return LocationResult(
            path=str(path),
            has_location=False,
            media_type="image",
            source="piexif",
            error=str(exc),
        )


def extract_with_ffprobe(path: Path) -> LocationResult | None:
    exe = shutil.which("ffprobe") or shutil.which("ffprobe.exe")
    if not exe:
        return None

    try:
        # Sadece format etiketleri: stream analizi yok → büyük MP4'lerde çok daha hızlı
        proc = subprocess.run(
            [
                exe,
                "-v",
                "quiet",
                "-probesize",
                "65536",
                "-analyzeduration",
                "0",
                "-print_format",
                "json",
                "-show_entries",
                "format_tags",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        data = json.loads(proc.stdout)
        tags: dict[str, Any] = {}
        if "format" in data and isinstance(data["format"].get("tags"), dict):
            tags.update(data["format"]["tags"])
        for stream in data.get("streams") or []:
            if isinstance(stream.get("tags"), dict):
                tags.update(stream["tags"])

        iso = _scan_tags_for_iso6709(tags)
        if iso:
            lat, lon, alt = iso
            return LocationResult(
                path=str(path),
                has_location=True,
                latitude=lat,
                longitude=lon,
                altitude=alt,
                source="ffprobe",
                media_type=_media_type(path),
                extra={"tags_found": list(tags.keys())},
            )

        pair = _looks_like_coord_pair(tags)
        if pair:
            return LocationResult(
                path=str(path),
                has_location=True,
                latitude=pair[0],
                longitude=pair[1],
                source="ffprobe",
                media_type=_media_type(path),
            )

        return LocationResult(
            path=str(path),
            has_location=False,
            media_type=_media_type(path),
            source="ffprobe",
        )
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError, TypeError):
        return None


def extract_with_pymediainfo(path: Path) -> LocationResult | None:
    try:
        from pymediainfo import MediaInfo
    except ImportError:
        return None

    try:
        info = MediaInfo.parse(str(path))
        tags: dict[str, Any] = {}
        for track in info.tracks:
            data = track.to_data()
            for key, value in data.items():
                if value is not None:
                    tags[key] = value
            # Also flatten known location fields
            for attr in (
                "xyz",
                "location",
                "latitude",
                "longitude",
                "recorded_location",
                "com_apple_quicktime_location_ISO6709",
            ):
                val = getattr(track, attr, None)
                if val:
                    tags[attr] = val

        iso = _scan_tags_for_iso6709(tags)
        if iso:
            lat, lon, alt = iso
            return LocationResult(
                path=str(path),
                has_location=True,
                latitude=lat,
                longitude=lon,
                altitude=alt,
                source="pymediainfo",
                media_type=_media_type(path),
            )

        # MediaInfo sometimes exposes lat/lon separately as strings with N/S
        lat_raw = tags.get("latitude") or tags.get("Latitude")
        lon_raw = tags.get("longitude") or tags.get("Longitude")
        if lat_raw is not None and lon_raw is not None:
            try:
                lat_s = str(lat_raw).strip().upper().replace("°", "")
                lon_s = str(lon_raw).strip().upper().replace("°", "")
                lat = float(re.sub(r"[^\d.\-]", "", lat_s.replace(",", ".")))
                lon = float(re.sub(r"[^\d.\-]", "", lon_s.replace(",", ".")))
                if "S" in lat_s:
                    lat = -abs(lat)
                if "W" in lon_s:
                    lon = -abs(lon)
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    return LocationResult(
                        path=str(path),
                        has_location=True,
                        latitude=lat,
                        longitude=lon,
                        source="pymediainfo",
                        media_type=_media_type(path),
                    )
            except ValueError:
                pass

        pair = _looks_like_coord_pair(tags)
        if pair:
            return LocationResult(
                path=str(path),
                has_location=True,
                latitude=pair[0],
                longitude=pair[1],
                source="pymediainfo",
                media_type=_media_type(path),
            )

        return LocationResult(
            path=str(path),
            has_location=False,
            media_type=_media_type(path),
            source="pymediainfo",
        )
    except Exception as exc:
        return LocationResult(
            path=str(path),
            has_location=False,
            media_type=_media_type(path),
            source="pymediainfo",
            error=str(exc),
        )


def extract_with_mutagen(path: Path) -> LocationResult | None:
    """Read QuickTime / MP4 location atoms via mutagen."""
    try:
        from mutagen import File as MutagenFile
    except ImportError:
        return None

    try:
        audio = MutagenFile(str(path))
        if audio is None:
            return None
        tags: dict[str, Any] = {}
        if hasattr(audio, "tags") and audio.tags:
            for key, value in audio.tags.items():
                tags[str(key)] = value

        # mutagen MP4 keys can be bytes-like keys
        candidates = []
        for key, value in tags.items():
            key_s = str(key).lower()
            if any(x in key_s for x in ("location", "iso6709", "xyz", "gps", "©xyz")):
                candidates.append(value)

        # Also check common freeform keys
        for key in list(tags.keys()):
            if "location" in str(key).lower() or "xyz" in str(key).lower():
                candidates.append(tags[key])

        for value in candidates:
            text = value
            if isinstance(value, (list, tuple)) and value:
                text = value[0]
            if hasattr(text, "decode"):
                try:
                    text = text.decode("utf-8", errors="ignore")
                except Exception:
                    text = str(text)
            text = str(text)
            parsed = _parse_iso6709(text.strip())
            if parsed:
                lat, lon, alt = parsed
                return LocationResult(
                    path=str(path),
                    has_location=True,
                    latitude=lat,
                    longitude=lon,
                    altitude=alt,
                    source="mutagen",
                    media_type=_media_type(path),
                )

        return LocationResult(
            path=str(path),
            has_location=False,
            media_type=_media_type(path),
            source="mutagen",
        )
    except Exception as exc:
        return LocationResult(
            path=str(path),
            has_location=False,
            media_type=_media_type(path),
            source="mutagen",
            error=str(exc),
        )


def _media_type(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return "unknown"


def _prefer_found(results: list[LocationResult | None]) -> LocationResult | None:
    found = [r for r in results if r and r.has_location and r.latitude is not None]
    if found:
        return found[0]
    nonempty = [r for r in results if r is not None]
    return nonempty[0] if nonempty else None


def _try_backends(path: Path, backends) -> LocationResult | None:
    """Try backends until GPS found. Clean misses from earlier backends still
    allow later ones in the same list; callers should put slow tools last and
    use _try_fast_then_slow for videos."""
    last: LocationResult | None = None
    for fn in backends:
        result = fn(path)
        if result is None:
            continue
        last = result
        if result.has_location:
            return result
    return last


def _try_fast_then_slow(path: Path, fast, slow) -> LocationResult | None:
    """Run all fast backends; only use slow ones if none could read the file."""
    last: LocationResult | None = None
    clean_miss = False
    for fn in fast:
        result = fn(path)
        if result is None:
            continue
        last = result
        if result.has_location:
            return result
        if result.error is None:
            clean_miss = True
    if clean_miss:
        return last
    for fn in slow:
        result = fn(path)
        if result is None:
            continue
        last = result
        if result.has_location:
            return result
        if result.error is None:
            return result
    return last


def extract_location(file_path: str | Path) -> LocationResult:
    path = Path(file_path)
    if not path.is_file():
        return LocationResult(
            path=str(path),
            has_location=False,
            error="Dosya bulunamadı.",
        )

    ext = path.suffix.lower()
    media = _media_type(path)

    if media == "image" or ext in IMAGE_EXTENSIONS:
        chosen = _try_fast_then_slow(
            path,
            fast=(extract_from_image_pillow, extract_from_image_piexif),
            slow=(extract_with_exiftool,),
        )
    elif media == "video" or ext in VIDEO_EXTENSIONS:
        # mutagen + ffprobe (metadata-only) hızlı; mediainfo/exiftool yavaş yedek
        chosen = _try_fast_then_slow(
            path,
            fast=(extract_with_mutagen, extract_with_ffprobe),
            slow=(extract_with_pymediainfo, extract_with_exiftool),
        )
    else:
        chosen = _try_backends(
            path,
            (
                extract_from_image_pillow,
                extract_from_image_piexif,
                extract_with_mutagen,
                extract_with_ffprobe,
                extract_with_pymediainfo,
                extract_with_exiftool,
            ),
        )

    if chosen:
        return chosen

    return LocationResult(
        path=str(path),
        has_location=False,
        media_type=media,
        error="Konum bilgisi bulunamadı (EXIF/metadata yok veya silinmiş olabilir).",
    )


def is_supported(file_path: str | Path) -> bool:
    return Path(file_path).suffix.lower() in ALL_EXTENSIONS or True  # try all files


def available_backends() -> dict[str, bool]:
    return {
        "exiftool": bool(shutil.which("exiftool") or shutil.which("exiftool.exe")),
        "ffprobe": bool(shutil.which("ffprobe") or shutil.which("ffprobe.exe")),
        "pillow": _can_import("PIL"),
        "piexif": _can_import("piexif"),
        "pillow_heif": _can_import("pillow_heif"),
        "pymediainfo": _can_import("pymediainfo"),
        "mutagen": _can_import("mutagen"),
    }


def _can_import(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False
