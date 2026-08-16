"""FastAPI masaüstü köprüsü.

GPS taraması Node sidecar'a (5175) proxy edilir.
Önizleme medyası diskten doğrudan akıtılır (Node hop yok).
Oynatma ve klasör açma Python'da kalır (sistem oynatıcı).
"""

from __future__ import annotations

import mimetypes
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, unquote

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import media_store
from .library_store import load_state, save_state
from .paths import resolve_existing
from .play import play_file
from .vlc_preview import get_preview


def _resolve_body_path(body: dict) -> Path | None:
    path = None
    raw = body.get("path")
    if isinstance(raw, str) and raw.strip():
        candidate = Path(raw.strip())
        try:
            if candidate.is_file():
                path = candidate
        except OSError:
            path = None
    mid = body.get("id")
    if path is None and mid:
        path = media_store.get_path(mid)
    if path is None:
        path = resolve_existing(body.get("rootPath"), body.get("relativePath"))
        if path is not None and mid:
            media_store.set_path(mid, path)
    return path

APP_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = APP_DIR.parent
NODE_URL = os.environ.get("MEDIAATLAS_NODE_URL", "http://127.0.0.1:5175").rstrip("/")
# main.py DEFAULT_PORT ile aynı — pywebview/paketli dağıtım burada servis edilir.
API_PORT = 5174


def _dist_dir() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "dist"  # type: ignore[attr-defined]
    return ROOT_DIR / "dist"


DIST_DIR = _dist_dir()

app = FastAPI(title="MedyaAtlas Desktop API")
app.add_middleware(
    CORSMiddleware,
    # Sadece kendi arayüzümüz (paketli dağıtım 5174, Vite dev 5173) — localhost-CSRF'i
    # önlemek için başka hiçbir origin dosya sistemine erişen bu endpoint'lere ulaşamaz.
    allow_origins=[
        f"http://localhost:{API_PORT}",
        f"http://127.0.0.1:{API_PORT}",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _json(data, status: int = 200):
    return JSONResponse(data, status_code=status)


async def proxy_node(request: Request) -> Response:
    target = f"{NODE_URL}{request.url.path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in ("host", "content-length", "connection")
    }
    body = await request.body()
    path = request.url.path
    is_media_stream = (
        path.startswith("/api/media/")
        or path.startswith("/api/transcoded/")
        or path.startswith("/api/thumbs/")
    )

    try:
        if (is_media_stream):
            # Büyük videoları belleğe alma — Range ile akıt
            client = httpx.AsyncClient(timeout=None)
            req = client.build_request(
                request.method,
                target,
                headers=headers,
                content=body if body else None,
            )
            upstream = await client.send(req, stream=True)
            out_headers = {
                k: v
                for k, v in upstream.headers.items()
                if k.lower()
                not in ("transfer-encoding", "connection", "content-encoding")
            }

            async def stream():
                try:
                    async for chunk in upstream.aiter_bytes(64 * 1024):
                        yield chunk
                finally:
                    await upstream.aclose()
                    await client.aclose()

            return StreamingResponse(
                stream(),
                status_code=upstream.status_code,
                headers=out_headers,
                media_type=upstream.headers.get("content-type"),
            )

        async with httpx.AsyncClient(timeout=None) as client:
            upstream = await client.request(
                request.method,
                target,
                headers=headers,
                content=body if body else None,
            )
    except Exception as exc:  # noqa: BLE001
        return _json(
            {
                "error": f"Node tarama servisi yanıt vermedi ({NODE_URL}). {exc}",
                "hint": "Python API, Node sidecar (5175) ile birlikte açılmalı.",
            },
            502,
        )

    content_type = upstream.headers.get("content-type", "")
    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower()
        not in ("transfer-encoding", "connection", "content-encoding", "content-length")
    }
    raw = upstream.content
    if not raw and upstream.status_code < 400:
        raw = b"{}"
    return Response(
        content=raw,
        status_code=upstream.status_code,
        headers=out_headers,
        media_type=content_type or "application/json",
    )


@app.get("/api/health")
async def health():
    node_ok = False
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{NODE_URL}/api/health")
            node_ok = resp.status_code == 200
    except Exception:
        node_ok = False
    return {"ok": True, "runtime": "python-desktop", "node": node_ok, "nodeUrl": NODE_URL}


def _guess_media_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        return guessed
    return {
        ".mov": "video/quicktime",
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".webm": "video/webm",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic",
        ".heif": "image/heif",
    }.get(path.suffix.lower(), "application/octet-stream")


@app.post("/api/resolve")
async def resolve_media(request: Request):
    """Yolu yerelde çöz — lightbox beklemesin diye Node'a gitme."""
    body = await request.json()
    mid = body.get("id")
    path = resolve_existing(body.get("rootPath"), body.get("relativePath"))
    if not isinstance(mid, str) or not mid or path is None or not path.is_file():
        return _json({"error": "Invalid media path."}, 400)
    media_store.set_path(mid, path)
    return {"url": f"/api/media/{quote(mid, safe='')}"}


@app.get("/api/media/{rest:path}")
async def serve_media(rest: str, request: Request):
    """Diskten doğrudan Range stream — büyük videoda belleğe alma yok."""
    mid = unquote(rest)
    path = media_store.get_path(mid)
    if path is not None and path.is_file():
        return FileResponse(
            path,
            media_type=_guess_media_type(path),
            content_disposition_type="inline",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "private, max-age=120",
            },
        )
    # Tarama sırasında sadece Node map'inde kalan id'ler
    return await proxy_node(request)


PROXY_ROUTES = (
    "/api/drives",
    "/api/scan",
    "/api/open",
    "/api/transcode",
    "/api/transcode-upload",
    "/api/thumb",
)
for route in PROXY_ROUTES:
    app.add_api_route(route, proxy_node, methods=["GET", "POST", "PUT", "DELETE", "PATCH"])


@app.post("/api/pick-folder")
def pick_folder():
    """Masaüstü klasör seçici — gerçek Windows yolu (sürücü çakışması için gerekli)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return _json({"error": "Klasör seçici yok."}, 501)
    root = tk.Tk()
    root.withdraw()
    try:
        root.wm_attributes("-topmost", True)
    except Exception:
        pass
    try:
        chosen = filedialog.askdirectory(title="Medya klasörü seç")
    finally:
        try:
            root.destroy()
        except Exception:
            pass
    if not chosen:
        return _json({"cancelled": True})
    return _json({"path": str(Path(chosen))})


@app.post("/api/availability")
async def availability(request: Request):
    """Disk bağlı mı — Node'a gitmeden yerel kontrol (tarama sırasında da hızlı)."""
    body = await request.json()
    sources = body.get("sources") if isinstance(body, dict) else None
    available: list[str] = []
    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, dict):
            continue
        sid = source.get("id")
        path = source.get("path")
        if not isinstance(sid, str) or not sid or not isinstance(path, str) or not path:
            continue
        try:
            if Path(path).exists():
                available.append(sid)
        except OSError:
            continue
    return {"available": available}


@app.api_route("/api/scan/{job_id:path}", methods=["GET", "POST"])
@app.api_route("/api/transcode/{rest:path}", methods=["GET"])
@app.api_route("/api/transcoded/{rest:path}", methods=["GET"])
@app.api_route("/api/thumbs/{rest:path}", methods=["GET"])
async def proxy_node_path(request: Request):
    return await proxy_node(request)


@app.post("/api/reveal")
async def reveal(request: Request):
    body = await request.json()
    path = None
    raw = body.get("path")
    if isinstance(raw, str) and raw.strip():
        candidate = Path(raw.strip())
        try:
            if candidate.exists():
                path = candidate
        except OSError:
            path = None
    mid = body.get("id")
    if path is None and mid:
        path = media_store.get_path(mid)
    if path is None:
        path = resolve_existing(body.get("rootPath"), body.get("relativePath"))
        if path is not None and mid:
            media_store.set_path(mid, path)
    # Node resolve: tarama sonrası id eşlemesi bozulmuş olabilir
    if path is None and body.get("rootPath") and body.get("relativePath"):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    f"{NODE_URL}/api/resolve",
                    json={
                        "id": mid or f"reveal-{body.get('relativePath')}",
                        "rootPath": body.get("rootPath"),
                        "relativePath": body.get("relativePath"),
                    },
                )
                if resp.status_code < 300:
                    path = resolve_existing(
                        body.get("rootPath"), body.get("relativePath")
                    )
        except Exception:
            pass
    if path is None:
        return _json({"error": "Media not found.", "tried": raw}, 404)

    if sys.platform == "win32":
        try:
            target = path.resolve()
        except OSError:
            target = path
        # Dosya seçili: explorer /select,C:\...\file.jpg  (liste args — tırnak tuzağı yok)
        if target.is_file():
            subprocess.Popen(
                ["explorer.exe", f"/select,{target}"],
                shell=False,
                close_fds=True,
            )
        else:
            folder = target if target.is_dir() else target.parent
            subprocess.Popen(["explorer.exe", str(folder)], shell=False)
    else:
        folder = path if path.is_dir() else path.parent
        subprocess.Popen(["xdg-open", str(folder)])
    return {
        "ok": True,
        "path": str(path),
        "folder": str(path if path.is_dir() else path.parent),
        "selected": path.is_file(),
    }


@app.post("/api/play")
async def play(request: Request):
    body = await request.json()
    path = _resolve_body_path(body)
    if path is None:
        return _json({"error": "Media not found."}, 404)
    result = play_file(path, prefer=body.get("player"))
    status = 200 if result.get("ok") else 500
    return _json(result, status)


@app.post("/api/preview")
async def preview_start(request: Request):
    """libVLC donanım decode — lightbox stage üzerine (viewport göreli) yerleşir."""
    body = await request.json()
    path = _resolve_body_path(body)
    if path is None:
        return _json({"error": "Media not found."}, 404)
    bounds = None
    viewport = body.get("viewport", True) is not False
    try:
        x, y, w, h = (
            int(body.get("x")),
            int(body.get("y")),
            int(body.get("width")),
            int(body.get("height")),
        )
        if w > 0 and h > 0:
            bounds = (x, y, w, h)
    except (TypeError, ValueError):
        bounds = None
    result = get_preview().play(path, bounds=bounds, viewport=viewport)
    status = 200 if result.get("ok") else 500
    return _json(result, status)


@app.post("/api/preview/bounds")
async def preview_bounds(request: Request):
    body = await request.json()
    viewport = body.get("viewport", True) is not False
    try:
        x, y, w, h = (
            int(body.get("x")),
            int(body.get("y")),
            int(body.get("width")),
            int(body.get("height")),
        )
    except (TypeError, ValueError):
        return _json({"error": "Invalid bounds."}, 400)
    return get_preview().set_bounds(x, y, w, h, viewport=viewport)


@app.post("/api/preview/stop")
async def preview_stop():
    return get_preview().stop()


@app.get("/api/preview/status")
async def preview_status():
    return get_preview().status()


@app.get("/api/library-state")
async def get_library_state():
    return load_state()


@app.put("/api/library-state")
async def put_library_state(request: Request):
    body = await request.json()
    sources = body.get("sources") if isinstance(body, dict) else None
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(sources, list) or not isinstance(items, list):
        return _json({"error": "sources and items arrays required."}, 400)
    try:
        return save_state(sources, items)
    except OSError as exc:
        return _json({"error": str(exc)}, 500)


def mount_static() -> None:
    if DIST_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")
