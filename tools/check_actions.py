#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check pinned Actions references before merging release workflows."""
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
USES = re.compile(r"^[ \t]*(?:-[ \t]+)?uses:[ \t]+[\"']?([^\s\"'#]+)", re.MULTILINE)
PIN = re.compile(r"([\w.-]+/[\w.-]+)(?:/[^@]+)?@([a-f0-9]{40})")


def verify_commit(repo, commit):
    for attempt in range(3):
        try:
            result = subprocess.run(
                ["gh", "api", f"repos/{repo}/commits/{commit}", "--jq", ".sha"],
                capture_output=True, text=True, timeout=20,
            )
            if result.returncode == 0 and result.stdout.strip() == commit:
                return
            error = result.stderr.strip() or "GitHub returned a different commit"
            if not re.search(r"HTTP (?:429|5\d\d)\b", error):
                break
        except subprocess.TimeoutExpired:
            error = "GitHub API request timed out"
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise ValueError(f"{repo}@{commit}: {error}")


def main():
    workflows = (ROOT / ".github/workflows").glob("*.y*ml")
    actions = (ROOT / ".github/actions").rglob("action.y*ml")
    references = {
        reference
        for path in (*workflows, *actions)
        for reference in USES.findall(path.read_text(encoding="utf-8"))
    }
    for reference in sorted(references):
        if reference.startswith("./"):
            path = ROOT / reference
            if not path.is_file() and not any((path / f"action.{ext}").is_file() for ext in ("yml", "yaml")):
                raise ValueError(f"Missing local action or workflow: {reference}")
            continue
        pin = PIN.fullmatch(reference)
        if not pin:
            raise ValueError(f"Pin this GitHub Action to a full commit SHA: {reference}")
        verify_commit(*pin.groups())
    print(f"Verified {len(references)} action and workflow references")


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from error
