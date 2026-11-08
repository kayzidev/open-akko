#!/usr/bin/env python3
# SPDX-FileCopyrightText: JR Lanteigne <root@dnim.dev>
# SPDX-License-Identifier: GPL-3.0-or-later
"""Render the notices for the modules and assets reported by Vite on stdin."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
NODE_MODULES = APP / "node_modules"

# Ship as generated CSS, outside the JavaScript chunks.
CSS_PACKAGES = ("tailwindcss", "tw-animate-css")

# Copied into the tree rather than installed, so no sourcemap or manifest
# names them. The files carry the same notice in their SPDX headers.
VENDORED = (
    {"name": "shadcn/ui", "license": "MIT",
     "holder": "Copyright (c) 2023 shadcn",
     "url": "https://ui.shadcn.com",
     "where": "app/src/components/ui, app/src/lib/utils.ts, app/src/vendor/shadcn-tailwind.css"},
)

LICENSE_NAMES = ("LICENSE", "LICENCE", "COPYING", "NOTICE")

# Order the appendix so the licenses most of the tree uses come first.
LICENSE_ORDER = ("MIT", "Apache-2.0", "OFL-1.1", "BSD-3-Clause", "BSD-2-Clause",
                 "ISC", "Zlib", "0BSD", "MPL-2.0", "Unicode-3.0", "Unlicense",
                 "CC0-1.0", "MIT-0")


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, encoding="utf-8", check=True).stdout


def license_files(d: Path):
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir()
                  if p.is_file() and p.name.upper().startswith(LICENSE_NAMES))


# A real grant line, not a sentence from the body of the license. Both the
# MIT and BSD texts talk about copyright in prose, and the disclaimers shout
# the word in caps.
HOLDER_LINE = re.compile(r"^Copyright\b(?!\s+(?:Holder|and|notice|statement))")


def is_copyright(line: str) -> bool:
    if not HOLDER_LINE.match(line) or len(line) > 300:
        return False
    letters = [c for c in line if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.6:
        return False
    return bool(re.search(r"(19|20)\d{2}|[<@]|https?://", line))


def copyrights(d: Path) -> list[str]:
    """Copyright lines from a package's license files. MIT and BSD require
    these to travel with the code; the SPDX text alone is not enough."""
    out = []
    for f in license_files(d):
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip(" \t*#/")
            if is_copyright(line) and line not in out:
                out.append(line)
    return out


def license_text(d: Path) -> str | None:
    files = license_files(d)
    if not files:
        return None
    return files[0].read_text(encoding="utf-8", errors="replace").strip()


def ids(expr: str) -> list[str]:
    """SPDX ids in a license expression. Dual licenses are recorded whole in
    the table; the appendix carries a text for each id so the reader can see
    whichever one they rely on."""
    parts = re.split(r"\s+(?:OR|AND)\s+|[/,]", expr or "")
    out = []
    for p in parts:
        p = re.sub(r"\s+WITH\s+.*$", "", p.strip(" ()")).strip()
        if p and p not in out:
            out.append(p)
    return out


def web_packages(modules: list[str]) -> list[dict]:
    """Packages whose code is in the built bundle, including nested copies."""
    directories = {NODE_MODULES / name for name in CSS_PACKAGES}
    for module in modules:
        parents, _, relative = f"node_modules/{module}".rpartition("node_modules/")
        parts = relative.split("/")
        name = "/".join(parts[:2]) if parts[0].startswith("@") else parts[0]
        directories.add(APP / f"{parents}node_modules/{name}")
    pkgs = []
    for d in sorted(directories):
        meta_path = d / "package.json"
        if not meta_path.is_file():
            sys.exit(f"Package metadata missing for {d}: run npm ci")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        lic = meta.get("license")
        if isinstance(lic, dict):
            lic = lic.get("type")
        if not lic and meta.get("licenses"):
            lic = " OR ".join(x.get("type", "") for x in meta["licenses"])
        pkgs.append({"name": meta["name"], "version": meta["version"],
                     "license": lic or "see package", "dir": d})
    return sorted(pkgs, key=lambda p: (p["name"], p["version"]))


def fonts(files: list[str]) -> list[dict]:
    """Fonts embedded in the web assets, with the attribution the OFL wants."""
    families = set()
    for f in (Path(name) for name in files if name.endswith(".woff2")):
        stem = re.sub(r"-[A-Za-z0-9_-]{8}$", "", f.stem)
        stem = re.sub(r"-(latin|cyrillic|greek|vietnamese)(-ext)?-.*$", "", stem)
        families.add(stem)
    out = []
    for fam in sorted(families):
        d = NODE_MODULES / f"@fontsource-variable/{fam}"
        if not d.is_dir():
            sys.exit(f"font {fam} is bundled but @fontsource-variable/{fam} is not installed")
        meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        pkg = json.loads((d / "package.json").read_text(encoding="utf-8"))
        src = meta.get("license") or {}
        attr = re.sub(r"\s+", " ", src.get("attribution", "")).strip()
        # Upstream repeats the same holder once per face; keep the first grant.
        first = re.match(r"(Copyright .*?\))", attr)
        attr = first.group(1) if first else attr
        out.append({"name": f"@fontsource-variable/{fam}", "version": pkg.get("version", ""),
                    "license": src.get("type", "OFL-1.1"), "family": meta.get("family", fam),
                    "attribution": attr, "dir": d})
    return out


def rust_crates(manifest_dir: Path) -> list[dict]:
    """Crates linked into a binary: normal dependencies reachable from the
    root, with dev- and build-only crates left out."""
    meta = json.loads(run(["cargo", "metadata", "--locked", "--format-version", "1"], manifest_dir))
    by_id = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    roots = meta["workspace_members"]
    seen, queue = set(), list(roots)
    while queue:
        pid = queue.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for dep in nodes.get(pid, {}).get("deps", []):
            if any(k.get("kind") is None for k in dep.get("dep_kinds", [])):
                queue.append(dep["pkg"])
    out = []
    for pid in seen:
        p = by_id[pid]
        if pid in roots:
            continue
        out.append({"name": p["name"], "version": p["version"],
                    "license": (p.get("license") or "see source").replace("/", " OR "),
                    "dir": Path(p["manifest_path"]).parent})
    return sorted(out, key=lambda p: (p["name"], p["version"]))


def table(rows: list[dict]) -> list[str]:
    out = ["| Package | Version | License |", "| --- | --- | --- |"]
    out += [f"| {r['name']} | {r['version']} | {r['license']} |" for r in rows]
    return out


def inventory(bundle: dict) -> dict:
    target = "src-web" if bundle["web"] else "src-tauri"
    return {
        "fonts": fonts(bundle["files"]),
        "web": web_packages(bundle["modules"]),
        "rust": rust_crates(APP / target),
    }


def render(inv: dict) -> str:
    L = ["# Third-party notices", "",
         "sharkfin itself is GPL-3.0-or-later; its terms are in `LICENSE`. The",
         "components below are redistributed inside the application and keep their",
         "own terms. Generated by `tools/notices.py`, do not edit.", ""]

    L += ["## Fonts", "",
          "Embedded in the application's web assets. The SIL Open Font License",
          "requires this notice and the license text to accompany the font files.", ""]
    for f in inv["fonts"]:
        L += [f"**{f['family']}** ({f['name']} {f['version']}), {f['license']}  ",
              f"{f['attribution']}", ""]

    L += ["## Web packages", "",
          "Bundled into the application's JavaScript and CSS.", ""]
    L += table(inv["web"]) + [""]

    L += ["## Vendored code", "",
          "Third-party source copied into the tree. The files keep their own",
          "license in an SPDX header.", ""]
    for v in VENDORED:
        L += [f"**{v['name']}** (<{v['url']}>), {v['license']}  ",
              f"{v['holder']}  ",
              f"In `{v['where']}`", ""]

    L += ["## Rust crates", "",
          "The list includes target-specific dependencies for the supported platforms.", ""]
    L += table(inv["rust"]) + [""]

    groups: dict[str, list[str]] = {}
    texts: dict[str, str] = {}
    for v in VENDORED:
        groups.setdefault(v["license"], []).append(v["holder"])
    for entry in inv["fonts"] + inv["web"] + inv["rust"]:
        for lid in ids(entry["license"]):
            groups.setdefault(lid, [])
            for c in copyrights(entry["dir"]):
                if c not in groups[lid]:
                    groups[lid].append(c)
            if lid not in texts:
                t = license_text(entry["dir"])
                # Only take a text from a package licensed under that id alone,
                # or a dual-licensed package would file its MIT text under
                # Apache-2.0.
                if t and ids(entry["license"]) == [lid]:
                    texts[lid] = t

    L += ["## License texts", ""]
    order = [x for x in LICENSE_ORDER if x in groups]
    order += sorted(x for x in groups if x not in LICENSE_ORDER)
    for lid in order:
        L += [f"### {lid}", ""]
        if groups[lid]:
            L += ["Copyright holders:", ""]
            L += [f"- {c}" for c in sorted(groups[lid])] + [""]
        if lid in texts:
            L += ["```", texts[lid], "```", ""]
        else:
            L += [f"Full text: <https://spdx.org/licenses/{lid}.html>", ""]
    return "\n".join(L).rstrip() + "\n"


if __name__ == "__main__":
    sys.stdout.buffer.write(render(inventory(json.load(sys.stdin.buffer))).encode("utf-8"))
