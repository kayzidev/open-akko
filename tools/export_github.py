#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Export source files without builds, local backups or signing secrets."""
import argparse
import base64
from pathlib import Path
import os
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", "target", "dist", "dist-web", "dist-ssr", "update-backups", "__pycache__", ".vscode", ".idea", "artifacts", ".release"}
SKIP_FILES = {"HANDOFF.md", "AKKO-STUDIO.md", "OPEN-AKKO.md", ".DS_Store"}


def sources(root=ROOT):
    for folder, dirs, files in os.walk(root):
        relative = Path(folder).relative_to(root)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not (relative == Path(".") and d == "bin") and not (relative == Path("app/src-web") and d == "pkg") and not (relative == Path("app/src-tauri") and d == "gen"))
        for name in sorted(files):
            path = Path(folder) / name
            rel = path.relative_to(root)
            if path.is_symlink() or name in SKIP_FILES or name.startswith(".env") or path.suffix in {".log", ".tmp", ".pyc", ".pfx", ".p12", ".pem"}:
                continue
            if (path.suffix == ".key" and rel != Path("packaging/updater/public.key")) or name.endswith(".key.pub"):
                continue
            data = path.read_bytes()
            if re.search(rb"(?m)^-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\r?$", data):
                raise ValueError(f"Private key detected in {rel}")
            try:
                decoded = base64.b64decode(data.strip(), validate=True)
            except (ValueError, base64.binascii.Error):
                decoded = b""
            if decoded.startswith(b"untrusted comment:") and b"secret key" in decoded.split(b"\n")[0]:
                raise ValueError(f"Private signing key detected in {rel}")
            yield path, rel


def export(destination):
    files = list(sources())
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, rel in files:
            archive.write(path, "open-akko/" + rel.as_posix())
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
    return len(files)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(f"Exported {export(args.destination)} source files to {args.destination}")
