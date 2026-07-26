"""libVLC donanım decode — MedyaAtlas penceresinin içine (lightbox stage) gömülür."""

from __future__ import annotations

import os
import queue
import sys
import threading
from pathlib import Path

from .play import _find_vlc

# Ana pywebview penceresinin HWND'i (main.py set eder)
_host_hwnd: int | None = None


def set_host_hwnd(hwnd: int | None) -> None:
    global _host_hwnd
    _host_hwnd = int(hwnd) if hwnd else None


def get_host_hwnd() -> int | None:
    return _host_hwnd


def _prepare_vlc_env() -> str | None:
    exe = _find_vlc()
    if not exe:
        return None
    vlc_dir = str(Path(exe).resolve().parent)
    path = os.environ.get("PATH", "")
    if vlc_dir.lower() not in path.lower():
        os.environ["PATH"] = vlc_dir + os.pathsep + path
    os.environ.setdefault("PYTHON_VLC_MODULE_PATH", vlc_dir)
    os.environ.setdefault("VLC_PLUGIN_PATH", str(Path(vlc_dir) / "plugins"))
    return vlc_dir


def _clamp_size(w: int, h: int) -> tuple[int, int]:
    w = max(160, min(int(w), 3840))
    h = max(90, min(int(h), 2160))
    return w, h


def _find_mediaatlas_hwnd() -> int | None:
    if _host_hwnd:
        return _host_hwnd
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found: list[int] = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_proc(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value
            if title.startswith("MedyaAtlas") and "Önizleme" not in title:
                found.append(int(hwnd))
            return True

        user32.EnumWindows(enum_proc, 0)
        return found[0] if found else None
    except Exception:
        return None


def _client_to_screen(hwnd: int, x: int, y: int) -> tuple[int, int]:
    import ctypes
    from ctypes import wintypes

    class POINT(ctypes.Structure):
        _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

    pt = POINT(int(x), int(y))
    ctypes.windll.user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return int(pt.x), int(pt.y)


def _window_class(hwnd: int) -> str:
    import ctypes

    buf = ctypes.create_unicode_buffer(256)
    ctypes.windll.user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _find_browser_hwnd(root: int) -> int:
    """WebView2 / Chromium child — viewport koordinatları buna göredir."""
    if sys.platform != "win32":
        return root
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found: list[int] = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_proc(hwnd, _lparam):
            cls = _window_class(int(hwnd))
            if (
                "Chrome_WidgetWin" in cls
                or "WebView" in cls
                or "Intermediate D3D" in cls
            ):
                found.append(int(hwnd))
            return True

        user32.EnumChildWindows(root, enum_proc, 0)
        # En içteki Chrome widget genelde listedeki sonlardandır
        return found[-1] if found else root
    except Exception:
        return root


def _map_viewport_bounds(
    left: int, top: int, width: int, height: int
) -> tuple[int, int, int, int, int | None]:
    """JS rect → (screenX, screenY, w, h, parent_hwnd)."""
    w, h = _clamp_size(width, height)
    host = _find_mediaatlas_hwnd()
    if host and sys.platform == "win32":
        browser = _find_browser_hwnd(host)
        sx, sy = _client_to_screen(browser, left, top)
        return sx, sy, w, h, browser
    return int(left), int(top), w, h, None


class VlcPreviewController:
    """Kenarlıksız libVLC; lightbox stage üzerine hizalı (ayrı uygulama penceresi gibi durmaz)."""

    def __init__(self) -> None:
        self._q: queue.Queue[tuple] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._error: str | None = None
        self._playing_path: str | None = None
        self._lock = threading.Lock()

    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._ready.clear()
        self._error = None
        self._thread = threading.Thread(target=self._run_ui, name="vlc-preview", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=8):
            self._error = self._error or "Önizleme penceresi başlamadı."

    def _run_ui(self) -> None:
        try:
            import tkinter as tk
        except Exception as exc:  # noqa: BLE001
            self._error = f"Tkinter yok: {exc}"
            self._ready.set()
            return

        if not _prepare_vlc_env():
            self._error = (
                "VLC kurulu değil. libVLC için VideoLAN VLC gerekli "
                "(https://www.videolan.org)."
            )
            self._ready.set()
            return

        try:
            import vlc
        except Exception as exc:  # noqa: BLE001
            self._error = f"python-vlc yüklenemedi: {exc}"
            self._ready.set()
            return

        try:
            instance = vlc.Instance(
                "--avcodec-hw=any",
                "--no-video-title-show",
                "--no-qt-error-dialogs",
                "--quiet",
                "--intf=dummy",
                "--extraintf=",
            )
            player = instance.media_player_new()
        except Exception as exc:  # noqa: BLE001
            self._error = f"libVLC açılamadı: {exc}"
            self._ready.set()
            return

        root = tk.Tk()
        root.overrideredirect(True)
        root.configure(bg="#000000")
        root.geometry("640x360+80+80")
        # topmost kaldırıldı — ayrı “uçan” pencere hissi vermesin
        try:
            root.attributes("-toolwindow", True)
        except tk.TclError:
            pass

        frame = tk.Frame(root, bg="#000000", highlightthickness=0, bd=0)
        frame.pack(fill=tk.BOTH, expand=True)

        root.withdraw()
        self._ready.set()

        def tk_hwnd() -> int:
            root.update_idletasks()
            return int(root.winfo_id())

        def bind_video() -> None:
            handle = frame.winfo_id()
            if sys.platform == "win32":
                player.set_hwnd(handle)
            elif sys.platform == "darwin":
                player.set_nsobject(handle)
            else:
                player.set_xwindow(handle)

        def apply_bounds(left: int, top: int, width: int, height: int, viewport: bool) -> None:
            w, h = _clamp_size(width, height)
            host = _find_mediaatlas_hwnd()
            if viewport and host and sys.platform == "win32":
                # WebView2 çocuğuna SetParent → siyah kare (VLC çizemez).
                # Ekran koordinatında kenarlıksız katman olarak stage üzerine oturt.
                browser = _find_browser_hwnd(host)
                try:
                    sx, sy = _client_to_screen(browser, left, top)
                    root.geometry(f"{w}x{h}+{sx}+{sy}")
                    root.deiconify()
                    root.lift()
                    try:
                        root.attributes("-topmost", True)
                        root.after(80, lambda: root.attributes("-topmost", False))
                    except tk.TclError:
                        pass
                    return
                except Exception:
                    sx, sy, w, h, _parent = _map_viewport_bounds(left, top, width, height)
                    root.geometry(f"{w}x{h}+{sx}+{sy}")
                    return
            if viewport:
                sx, sy, w, h, _parent = _map_viewport_bounds(left, top, width, height)
                root.geometry(f"{w}x{h}+{sx}+{sy}")
            else:
                root.geometry(f"{w}x{h}+{int(left)}+{int(top)}")

        def do_play(
            path: str,
            bounds: tuple[int, int, int, int] | None,
            viewport: bool,
        ) -> None:
            media = instance.media_new(path)
            player.set_media(media)
            root.deiconify()
            root.update_idletasks()
            if bounds:
                apply_bounds(bounds[0], bounds[1], bounds[2], bounds[3], viewport)
            bind_video()
            player.play()
            with self._lock:
                self._playing_path = path

        def do_bounds(left: int, top: int, w: int, h: int, viewport: bool) -> None:
            if root.state() == "withdrawn":
                return
            apply_bounds(left, top, w, h, viewport)

        def do_stop() -> None:
            try:
                player.stop()
            except Exception:
                pass
            with self._lock:
                self._playing_path = None
            root.withdraw()

        def poll() -> None:
            try:
                while True:
                    cmd = self._q.get_nowait()
                    op = cmd[0]
                    if op == "play":
                        do_play(
                            cmd[1],
                            cmd[2] if len(cmd) > 2 else None,
                            bool(cmd[3]) if len(cmd) > 3 else True,
                        )
                    elif op == "bounds":
                        do_bounds(cmd[1], cmd[2], cmd[3], cmd[4], bool(cmd[5]))
                    elif op == "stop":
                        do_stop()
                    elif op == "quit":
                        do_stop()
                        root.destroy()
                        return
            except queue.Empty:
                pass
            root.after(40, poll)

        root.after(40, poll)
        try:
            root.mainloop()
        finally:
            try:
                player.stop()
                player.release()
                instance.release()
            except Exception:
                pass

    def play(
        self,
        path: Path,
        bounds: tuple[int, int, int, int] | None = None,
        *,
        viewport: bool = True,
    ) -> dict:
        if not path.is_file():
            return {"ok": False, "error": "Dosya bulunamadı."}
        self._ensure_thread()
        if self._error:
            return {"ok": False, "error": self._error}
        self._q.put(("play", str(path.resolve()), bounds, viewport))
        return {"ok": True, "engine": "libvlc", "path": str(path), "hw": True, "embedded": True}

    def set_bounds(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        *,
        viewport: bool = True,
    ) -> dict:
        if self._thread and self._thread.is_alive():
            self._q.put(("bounds", x, y, w, h, viewport))
        return {"ok": True}

    def stop(self) -> dict:
        if self._thread and self._thread.is_alive():
            self._q.put(("stop",))
        with self._lock:
            self._playing_path = None
        return {"ok": True}

    def status(self) -> dict:
        with self._lock:
            path = self._playing_path
        return {"ok": True, "playing": bool(path), "path": path}


_controller: VlcPreviewController | None = None


def get_preview() -> VlcPreviewController:
    global _controller
    if _controller is None:
        _controller = VlcPreviewController()
    return _controller
