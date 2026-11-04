#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Version, collect and publish complete signed Windows/Linux releases."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tomllib
from datetime import datetime, timezone
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "kayzidev/open-akko"
PLATFORMS = {"linux": ("linux-x86_64", "AppImage", "appimage"), "windows": ("windows-x86_64", "exe", "nsis")}


def version(value):
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
        raise ValueError("Expected a stable major.minor.patch version")
    return value


def repository(value):
    if value != REPOSITORY:
        raise ValueError(f"Release repository must be {REPOSITORY}; configure the client before changing it")
    return value


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate(root=ROOT):
    config = read_json(root / "app/src-tauri/tauri.conf.json")
    package = read_json(root / "app/package.json")
    native = tomllib.loads((root / "app/src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    if not (config["version"] == package["version"] == native["package"]["version"]):
        raise ValueError("Tauri, frontend and native versions must match")
    version(config["version"])
    updater = config["plugins"]["updater"]
    expected = f"https://github.com/{REPOSITORY}/releases/latest/download/latest.json"
    if updater["endpoints"] != [expected]:
        raise ValueError("Incorrect update endpoint")
    key = (root / "packaging/updater/public.key").read_text(encoding="utf-8").strip()
    if updater["pubkey"] != key or not base64.b64decode(key, validate=True).startswith(b"untrusted comment:"):
        raise ValueError("Missing or inconsistent signing public key")
    if any(updater.get(k, False) for k in ["dangerousInsecureTransportProtocol", "dangerousAcceptInvalidCerts", "dangerousAcceptInvalidHostnames", "allowDowngrades"]):
        raise ValueError("Updates must use TLS, valid certificates and newer versions")
    # Check packaging inputs before spending time on a signed platform build.
    # Resource mappings use source keys; Linux bundle mappings use source values.
    inputs = list(config.get("bundle", {}).get("resources", {}))
    for bundle in config.get("bundle", {}).get("linux", {}).values():
        inputs.extend(bundle.get("files", {}).values())
    for source in inputs:
        if not (root / "app/src-tauri" / source).is_file():
            raise ValueError(f"Missing packaging input: {source}")
    return config["version"]


def numbered_version(run_number, root=ROOT):
    if run_number < 1:
        raise ValueError("Run number must be positive")
    major, minor, patch = map(int, validate(root).split("."))
    return f"{major}.{minor}.{patch + run_number}"


def prepare(release_version, platform, root=ROOT):
    version(release_version)
    validate(root)
    for name in ["app/package.json", "app/package-lock.json", "app/src-tauri/tauri.conf.json"]:
        path = root / name
        value = read_json(path)
        value["version"] = release_version
        if name.endswith("package-lock.json"):
            value["packages"][""]["version"] = release_version
        write_json(path, value)
    for name in ["src-tauri", "src-web"]:
        path = root / f"app/{name}/Cargo.toml"
        text = path.read_text(encoding="utf-8")
        text = re.sub(r'(?m)^version = "[^"]+"', f'version = "{release_version}"', text, count=1)
        path.write_text(text, encoding="utf-8")
        lock = path.with_name("Cargo.lock")
        if lock.exists():
            text = lock.read_text(encoding="utf-8")
            text = re.sub(r'(\[\[package\]\]\nname = "sharkfin(?:-web)?"\nversion = ")[^"]+', lambda m: m[1] + release_version, text)
            lock.write_text(text, encoding="utf-8")
    overlay_name = "tauri.windows.conf.json" if platform == "windows" else "tauri.fedora.conf.json"
    overlay = read_json(root / "app/src-tauri" / overlay_name)
    overlay["bundle"]["createUpdaterArtifacts"] = True
    write_json(root / ".release/tauri-release.json", overlay)


def artifact_name(release_version, platform):
    extension = PLATFORMS[platform][1]
    suffix = "windows-x64-setup" if platform == "windows" else "linux-x64"
    return f"Open-Akko_{version(release_version)}_{suffix}.{extension}"


def signature(path):
    value = path.read_text(encoding="utf-8").strip()
    if not base64.b64decode(value, validate=True).startswith(b"untrusted comment:"):
        raise ValueError(f"Invalid or empty signature: {path.name}")
    return value


def collect(release_version, platform, root=ROOT):
    extension, bundle = PLATFORMS[platform][1:]
    folder = root / "app/src-tauri/target/release/bundle" / bundle
    files = sorted(folder.glob(f"*_{version(release_version)}_*.{extension}"))
    if len(files) != 1:
        raise ValueError(f"Expected one {platform} artifact, found {len(files)}")
    source = files[0]
    signature(Path(str(source) + ".sig"))
    destination = root / "artifacts/release" / artifact_name(release_version, platform)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    shutil.copy2(Path(str(source) + ".sig"), Path(str(destination) + ".sig"))


def manifest(release_version, repo, root=ROOT):
    version(release_version)
    repository(repo)
    folder = root / "artifacts/release"
    platforms = {}
    for platform, (target, _, _) in PLATFORMS.items():
        name = artifact_name(release_version, platform)
        artifact = folder / name
        if not artifact.is_file() or artifact.stat().st_size == 0:
            raise ValueError(f"Missing release artifact: {name}")
        platforms[target] = {"url": f"https://github.com/{repo}/releases/download/v{release_version}/{quote(name)}", "signature": signature(folder / (name + ".sig"))}
    value = {"version": release_version, "notes": (root / ".github/release-notes.md").read_text(encoding="utf-8"), "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "platforms": platforms}
    write_json(folder / "latest.json", value)
    files = sorted(p for p in folder.iterdir() if p.is_file() and p.name != "SHA256SUMS.txt")
    (folder / "SHA256SUMS.txt").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files), encoding="utf-8")


def publish(release_version, repo, commit, root=ROOT):
    version(release_version)
    repository(repo)
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Release must point to an exact commit")
    validate(root)
    artifacts = [str(root / "artifacts/release" / artifact_name(release_version, platform)) for platform in PLATFORMS]
    subprocess.run(["cargo", "run", "--locked", "--manifest-path", str(root / "tools/verify-release/Cargo.toml"), "--", str(root / "packaging/updater/public.key"), *artifacts], cwd=root, check=True)
    tag = "v" + release_version
    def gh(*args, check=True):
        return subprocess.run(["gh", *args, "--repo", repo], cwd=root, capture_output=True, text=True, check=check)
    existing = gh("release", "view", tag, "--json", "isDraft,targetCommitish", check=False)
    if existing.returncode == 0:
        info = json.loads(existing.stdout)
        if info["targetCommitish"] != commit:
            raise ValueError("The existing tag belongs to a different commit")
        if not info["isDraft"]:
            print("This version is already published; leaving all artifacts unchanged.")
            return
    else:
        gh("release", "create", tag, "--target", commit, "--draft", "--title", f"Open Akko {release_version}", "--notes-file", ".github/release-notes.md")
    files = [str(p) for p in sorted((root / "artifacts/release").iterdir()) if p.is_file()]
    gh("release", "upload", tag, *files, "--clobber")
    gh("release", "edit", tag, "--draft=false", "--latest")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    p = sub.add_parser("version")
    p.add_argument("--run-number", type=int, required=True)
    p.add_argument("--repository", required=True)
    p.add_argument("--github-output", type=Path)
    p = sub.add_parser("prepare")
    p.add_argument("--version", required=True)
    p.add_argument("--platform", choices=PLATFORMS, required=True)
    for command in ["collect", "manifest", "publish"]:
        p = sub.add_parser(command)
        p.add_argument("--version", required=True)
        if command == "collect": p.add_argument("--platform", choices=PLATFORMS, required=True)
        else: p.add_argument("--repository", required=True)
        if command == "publish": p.add_argument("--commit", required=True)
    args = parser.parse_args()
    if args.command == "validate": print(f"Release configuration OK: {validate()}")
    elif args.command == "version":
        repository(args.repository)
        value = numbered_version(args.run_number)
        text = f"version={value}\ntag=v{value}\n"
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as out: out.write(text)
        print(text, end="")
    elif args.command == "prepare": prepare(args.version, args.platform)
    elif args.command == "collect": collect(args.version, args.platform)
    elif args.command == "manifest": manifest(args.version, args.repository)
    elif args.command == "publish": publish(args.version, args.repository, args.commit)


if __name__ == "__main__":
    main()
