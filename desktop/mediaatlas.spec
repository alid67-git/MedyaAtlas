# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller: önce npm run build, sonra:
   pyinstaller desktop/mediaatlas.spec
"""

from pathlib import Path

from PyInstaller.building.api import EXE, PYZ
from PyInstaller.building.datastruct import Tree
from PyInstaller.building.build_main import Analysis
from PyInstaller.utils.hooks import collect_all

SPECPATH = Path(SPEC).parent.resolve()
ROOT = SPECPATH.parent

datas = []
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "webview",
    "server",
    "server.app",
    "server.scan",
    "server.gps",
    "server.play",
    "server.paths",
    "server.media_store",
]

tmp_ret = collect_all("webview")
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

dist_dir = ROOT / "dist"
if dist_dir.is_dir():
    datas += Tree(str(dist_dir), prefix="dist")

a = Analysis(
    [str(SPECPATH / "main.py")],
    pathex=[str(SPECPATH)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="MedyaAtlas",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
