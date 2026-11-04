#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Preserve the upstream AppImage permissions and bundled-GIO fixes, then re-sign."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import fnmatch

ROOT = Path(__file__).resolve().parent.parent

# Host Mesa/EGL must use the host display stack. Ubuntu 22.04 copies abort
# WebKit on Fedora 44 with EGL_BAD_PARAMETER (tauri-apps/tauri#15976).
HOST_DISPLAY_LIBRARIES = (
    "libwayland-client.so*", "libwayland-cursor.so*",
    "libwayland-egl.so*", "libwayland-server.so*", "libxkbcommon.so*",
    "libxcb-randr.so*", "libxcb-render.so*", "libxcb-shm.so*",
    "libXau.so*", "libXdmcp.so*",
)


def bundled_display_libraries(root):
    return sorted(
        path for folder in (root / "usr/lib", root / "usr/lib64")
        if folder.exists() for path in folder.rglob("*")
        if (path.is_file() or path.is_symlink())
        and any(fnmatch.fnmatchcase(path.name, pattern) for pattern in HOST_DISPLAY_LIBRARIES)
    )


def use_host_display_libraries(root):
    for path in bundled_display_libraries(root):
        print(f"Use host display library: {path.relative_to(root)}")
        path.unlink()


def run(*args, capture=False):
    return subprocess.run(list(map(str, args)), check=True, capture_output=capture, text=capture)


def main():
    if not os.environ.get("TAURI_SIGNING_PRIVATE_KEY"):
        raise SystemExit("A signing key is required after repacking the AppImage")
    images = list((ROOT / "app/src-tauri/target/release/bundle/appimage").glob("*.AppImage"))
    if len(images) != 1: raise SystemExit("Expected exactly one AppImage")
    image = images[0]
    image.chmod(0o755)
    offset = int(run(image, "--appimage-offset", capture=True).stdout.strip())
    with tempfile.TemporaryDirectory(prefix="akko-appimage-") as tmp:
        folder = Path(tmp)
        extracted = folder / "root"
        run("unsquashfs", "-o", offset, "-d", extracted, image)
        for name in ["AppRun", "AppRun.wrapped"]: (extracted / name).chmod(0o755)
        if "apprun-hooks" not in (extracted / "AppRun").read_text():
            raise SystemExit("Unexpected AppRun: bundled-GIO hook cannot be installed")
        hooks = extracted / "apprun-hooks"
        hooks.mkdir(exist_ok=True)
        (hooks / "akko-gio.sh").write_text('export GIO_MODULE_DIR="$APPDIR/usr/lib/gio/modules"\n')
        use_host_display_libraries(extracted)
        run("python3", ROOT / "tools/glibc_floor.py", ROOT / "app/src-tauri/target/release/sharkfin", extracted)
        summary = run("unsquashfs", "-s", "-o", offset, image, capture=True).stdout
        compression = re.search(r"(?m)^Compression (\S+)", summary)
        if not compression: raise SystemExit("Unknown SquashFS compression")
        squashfs = folder / "fixed.sqfs"
        run("mksquashfs", extracted, squashfs, "-comp", compression[1], "-noappend", "-all-root", "-no-progress", "-processors", "2")
        fixed = folder / "fixed.AppImage"
        with image.open("rb") as source, fixed.open("wb") as destination:
            remaining = offset
            while remaining:
                block = source.read(min(1024 * 1024, remaining))
                if not block: raise SystemExit("Truncated AppImage runtime")
                destination.write(block)
                remaining -= len(block)
            with squashfs.open("rb") as source: shutil.copyfileobj(source, destination)
        fixed.chmod(0o755)
        checked = folder / "check"
        run("unsquashfs", "-o", offset, "-d", checked, fixed)
        if bundled_display_libraries(checked):
            raise SystemExit("Host display libraries were reintroduced into the AppImage")
        if (checked / "AppRun.wrapped").stat().st_mode & 0o777 != 0o755:
            raise SystemExit("AppRun permissions were not preserved")
        # shutil.copyfile handles a temporary directory on another filesystem.
        shutil.copyfile(fixed, image)
        image.chmod(0o755)
    Path(str(image) + ".sig").unlink(missing_ok=True)
    run(ROOT / "app/node_modules/.bin/tauri", "signer", "sign", image)


if __name__ == "__main__": main()
