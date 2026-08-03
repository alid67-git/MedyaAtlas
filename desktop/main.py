"""
MedyaAtlas masaüstü girişi.

Çift tıkla: baslat.bat  → Vite + API + pywebview penceresi (tarayıcı açılmaz)

Geliştirme:
  npm run dev                 # bir terminal
  npm run desktop             # API + masaüstü penceresi

Paket (exe):
  npm run desktop:portable    # release/MedyaAtlas/ + zip
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


def enable_dpi_awareness() -> None:
    """CSS px ↔ fiziksel px eşlemesi için Per-Monitor V2."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        return
    except Exception:
        pass
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            import ctypes

            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def log_path() -> Path:
    base = app_dir() if getattr(sys, "frozen", False) else ROOT_DIR
    return base / "medyaatlas-startup.log"


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n"
    try:
        with open(log_path(), "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    try:
        print(msg, flush=True)
    except Exception:
        pass


def ensure_stdio() -> None:
    """console=False exe'da stdout/stderr None olur; uvicorn çöker."""
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        try:
            sys.stderr = open(log_path(), "a", encoding="utf-8")
        except OSError:
            sys.stderr = open(os.devnull, "w", encoding="utf-8")


def show_error(title: str, message: str) -> None:
    log(f"ERROR {title}: {message}")
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
        except Exception:
            pass


def app_dir() -> Path:
    """Exe yanındaki klasör (frozen) veya repo kökü."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return ROOT_DIR


def sidecar_dir() -> Path:
    """Node GPS servisinin çalıştığı klasör."""
    if getattr(sys, "frozen", False):
        return app_dir() / "sidecar"
    return ROOT_DIR


def start_api(host: str, port: int) -> None:
    try:
        import uvicorn
        from server.app import app, mount_static

        mount_static()
        log(f"API dinleniyor: {host}:{port}")
        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as exc:
        log(f"API çöktü: {exc!r}")
        show_error("MedyaAtlas API", f"Arka plan servisi başlamadı:\n{exc}")


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
    """GPS taraması için Node sunucusunu 5175'te aç."""
    side = sidecar_dir()
    frozen = getattr(sys, "frozen", False)
    if frozen:
        node_bin = side / ("node.exe" if sys.platform == "win32" else "node")
        script = side / "server" / "index.mjs"
        cwd = str(side)
        if not node_bin.is_file() or not script.is_file():
            print(
                f"Paket eksik: {node_bin} veya {script} yok.",
                file=sys.stderr,
            )
            return None
        cmd = [str(node_bin), str(script)]
    else:
        script = ROOT_DIR / "server" / "index.mjs"
        cwd = str(ROOT_DIR)
        cmd = ["node", str(script)]

    env = {
        **os.environ,
        "MEDIAATLAS_API_PORT": str(NODE_PORT),
    }
    if frozen:
        env["NODE_PATH"] = str(side / "node_modules")

    node = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    os.environ["MEDIAATLAS_NODE_URL"] = f"http://127.0.0.1:{NODE_PORT}"
    if not wait_health(f"http://127.0.0.1:{NODE_PORT}/api/health", timeout=40):
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
    webview.start(
        private_mode=False,
        storage_path=str(webview_storage_path()),
    )


def main(argv: list[str] | None = None) -> int:
    enable_dpi_awareness()
    ensure_stdio()
    if getattr(sys, "frozen", False):
        try:
            import multiprocessing

            multiprocessing.freeze_support()
        except Exception:
            pass
    log(f"Başlatılıyor frozen={getattr(sys, 'frozen', False)} exe={sys.executable}")

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
            show_error(
                "MedyaAtlas",
                f"Port {args.port} kullanımda.\nEski MedyaAtlas / baslat.bat penceresini kapatıp tekrar dene.",
            )
            return 1
        finally:
            sock.close()

        node_proc = start_node_sidecar()
        if node_proc is None:
            show_error(
                "MedyaAtlas",
                "GPS tarama servisi başlamadı.\n"
                + (
                    "Paket içindeki sidecar klasörü eksik olabilir."
                    if getattr(sys, "frozen", False)
                    else "Node.js kurulu mu?"
                ),
            )
            return 1

        api_thread = threading.Thread(
            target=start_api,
            args=(args.host, args.port),
            daemon=True,
        )
        api_thread.start()
        if not wait_health(f"http://127.0.0.1:{args.port}/api/health", timeout=45):
            show_error(
                "MedyaAtlas",
                "Python API başlamadı.\n"
                f"Ayrıntı: {log_path()}",
            )
            if node_proc:
                node_proc.terminate()
            return 1

        log(f"Python köprü hazır: http://{args.host}:{args.port}")

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
            show_error("MedyaAtlas", "API yok. Önce: npm run desktop:api")
            return 1

    ui = args.ui.strip()
    if not ui:
        meipass = getattr(sys, "_MEIPASS", None)
        dist_index = (
            Path(meipass) / "dist" / "index.html"
            if meipass
            else ROOT_DIR / "dist" / "index.html"
        )
        if not dist_index.is_file() and getattr(sys, "frozen", False):
            dist_index = app_dir() / "_internal" / "dist" / "index.html"
        if not dist_index.is_file() and getattr(sys, "frozen", False):
            dist_index = app_dir() / "dist" / "index.html"
        if dist_index.is_file() or getattr(sys, "frozen", False):
            ui = f"http://127.0.0.1:{args.port}/"
        else:
            ui = "http://127.0.0.1:5173/"
            log("dist yok — Vite: npm run dev")

    try:
        log(f"Pencere açılıyor: {ui}")
        open_window(ui)
    except Exception as exc:
        show_error("MedyaAtlas", f"Pencere açılamadı:\n{exc}")
        return 1
    finally:
        if node_proc:
            node_proc.terminate()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        ensure_stdio()
        show_error("MedyaAtlas", f"Beklenmeyen hata:\n{exc}")
        raise SystemExit(1)
