# PyInstaller recipe for the agent, bundled with the desktop app, which starts it with `serve --ipc`.
#   uv run --group build pyinstaller devices-agent.spec --noconfirm
# `npm run agent:build` (repository root) runs this and copies dist/devices-agent/ where Tauri
# bundles it from.
#
# A folder (onedir), not a single self-extracting file: a onefile executable unpacks itself into
# %TEMP% and starts itself again from there at every launch, which behavioural antivirus engines
# (Kaspersky's System Watcher) take for a trojan. From the install folder, it just runs.
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
    exclude_binaries=True,
    name="devices-agent",
    console=True,  # the desktop app starts it without a window (CREATE_NO_WINDOW)
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="devices-agent", upx=False)
