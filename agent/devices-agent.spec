# PyInstaller recipe for the agent as one executable, bundled with the desktop app (a Tauri
# sidecar, started with `serve --ipc`).
#   uv run --group build pyinstaller devices-agent.spec --noconfirm
# `npm run agent:build` (repository root) runs this and copies dist/devices-agent.exe where Tauri
# expects it.
# -*- mode: python -*-

from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["__main__.py"],
    pathex=["."],
    # Vendors and CLI commands are imported by name.
    hiddenimports=collect_submodules("src") + ["hid"],
    excludes=["tkinter"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="devices-agent",
    console=True,  # the desktop app starts it without a window (CREATE_NO_WINDOW)
    upx=False,
)
