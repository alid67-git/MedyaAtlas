"""
MedyaAtlas masaüstü girişi.

Çift tıkla: baslat.bat  → Vite + API + pywebview penceresi (tarayıcı açılmaz)

Geliştirme:
  npm run dev                 # bir terminal
  npm run desktop             # API + masaüstü penceresi
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

DESKTOP_DIR = Path(__file__).resolve().parent
ROOT_DIR = DESKTOP_DIR.parent
if str(DESKTOP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_DIR))

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5174
NODE_PORT = int(os.environ.get("MEDIAATLAS_NODE_PORT", "5175"))


def start_api(host: str, port: int) -> None:
    import uvicorn
    from server.app import app, mount_static

    mount_static()
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)


def wait_health(url: str, timeout: float = 30.0) -> bool:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def start_node_sidecar() -> subprocess.Popen | None:
    """GPS tarama için Node sunucusunu 5175'te aç."""
    node = subprocess.Popen(
        ["node", str(ROOT_DIR / "server" / "index.mjs")],
        cwd=str(ROOT_DIR),
        env={
            **os.environ,
            "MEDIAATLAS_API_PORT": str(NODE_PORT),
        },
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    os.environ["MEDIAATLAS_NODE_URL"] = f"http://127.0.0.1:{NODE_PORT}"
    if not wait_health(f"http://127.0.0.1:{NODE_PORT}/api/health", timeout=25):
        node.terminate()
        return None
    print(f"MedyaAtlas Node GPS servisi: {NODE_PORT}")
    return node


def open_window(url: str) -> None:
    import webview
    from server.library_store import webview_storage_path
    from server.vlc_preview import set_host_hwnd

    window = webview.create_window(
        "MedyaAtlas",
        url,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#0b1220",
    )

    def on_loaded():
        try:
            window.evaluate_js(
                "window.__MEDIAATLAS_DESKTOP__ = true;"
                "window.__MEDIAATLAS_RUNTIME__ = 'python';"
            )
        except Exception:
            pass
        # libVLC önizlemeyi bu pencerenin içine hizala
        try:
            native = getattr(window, "native", None)
            hwnd = None
            if native is not None:
                handle = getattr(native, "Handle", None)
                if handle is not None:
                    hwnd = int(handle.ToInt32()) if hasattr(handle, "ToInt32") else int(handle)
                elif isinstance(native, int):
                    hwnd = native
            if hwnd:
                set_host_hwnd(hwnd)
        except Exception:
            pass

    window.events.loaded += on_loaded
    # private_mode=True (varsayılan) IndexedDB'yi her oturumda siler —
    # sürücü/kütüphane kayıtları kaybolur. Sabit storage ile kalıcı tut.
    webview.start(
        private_mode=False,
        storage_path=str(webview_storage_path()),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MedyaAtlas masaüstü")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--api-only", action="store_true")
    parser.add_argument("--ui-only", action="store_true")
    parser.add_argument("--ui", default=os.environ.get("MEDIAATLAS_UI", ""))
    args = parser.parse_args(argv)

    node_proc = None

    if not args.ui_only:
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind((args.host, args.port))
        except OSError:
            print(
                f"Port {args.port} kullanımda. Eski API'yi kapatıp tekrar dene.",
                file=sys.stderr,
            )
            return 1
        finally:
            sock.close()

        # GPS için Node (5175) — Python sadece köprü + oynatma
        node_proc = start_node_sidecar()
        if node_proc is None:
            print(
                f"Node GPS servisi {NODE_PORT} başlamadı. `node` kurulu mu?",
                file=sys.stderr,
            )
            return 1

        api_thread = threading.Thread(
            target=start_api,
            args=(args.host, args.port),
            daemon=True,
        )
        api_thread.start()
        if not wait_health(f"http://127.0.0.1:{args.port}/api/health"):
            print("Python API başlamadı.", file=sys.stderr)
            if node_proc:
                node_proc.terminate()
            return 1

        print(f"MedyaAtlas Python köprü: http://{args.host}:{args.port}")

        if args.api_only:
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                if node_proc:
                    node_proc.terminate()
                return 0
    else:
        if not wait_health(f"http://127.0.0.1:{args.port}/api/health", timeout=3):
            print(
                f"API yok. Önce: npm run desktop:api",
                file=sys.stderr,
            )
            return 1

    ui = args.ui.strip()
    if not ui:
        meipass = getattr(sys, "_MEIPASS", None)
        dist_index = (
            Path(meipass) / "dist" / "index.html"
            if meipass
            else ROOT_DIR / "dist" / "index.html"
        )
        if dist_index.is_file():
            ui = f"http://localhost:{args.port}/"
        else:
            ui = "http://localhost:5173/"
            print("dist yok — Vite: npm run dev")

    try:
        open_window(ui)
    finally:
        if node_proc:
            node_proc.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
