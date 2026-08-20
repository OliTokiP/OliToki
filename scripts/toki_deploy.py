#!/usr/bin/env python3
"""Ship a git ref onto the testing or restaurant branch and pin env.js.

Used by .github/workflows/deploy.yml. Does not force-push.
Cloud Run deploy is a separate step in the workflow (needs gcloud).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))
import write_env  # noqa: E402

DEFAULT_TESTING_API = (
    os.environ.get("TOKI_TESTING_API")
    or "https://toki-api-testing-3rx5m3qpzq-uc.a.run.app"
).strip()
DEFAULT_TESTING_SITE = (
    os.environ.get("TOKI_TESTING_SITE") or DEFAULT_TESTING_API
).strip()
RESTAURANT_SITE = "https://olitokip.github.io/OliToki"
RESTAURANT_API = "https://toki-api-3rx5m3qpzq-uc.a.run.app"
# Rewritten after every ship. They always conflict on merge; take source, then rewrite.
GENERATED_SHIP_FILES = ("js/live-stamp.js", "js/env.js", "js/build-info.js")
VERSION_SCRIPT_RE = re.compile(
    r"(js/(?:live-stamp|build-info|version)\.js)\?v=[^\"']+"
)


def run(args: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    print("+", " ".join(args), flush=True)
    return subprocess.run(
        args,
        cwd=ROOT,
        check=check,
        text=True,
        capture_output=capture,
    )


def git_out(args: list[str]) -> str:
    return run(["git"] + args, capture=True).stdout.strip()


def parse_issue_body(text: str) -> dict:
    fields = {
        "target": "",
        "ship": "both",
        "source": "main",
        "pin": "auto",
        "promote": "no",
        "dry-run": "no",
        "confirm-restaurant": "no",
        "notes": "",
    }
    for raw in StringIO_lines(text):
        m = re.match(r"-\s*([a-z0-9-]+)\s*:\s*(.*)$", raw.strip(), re.I)
        if not m:
            continue
        key = m.group(1).lower()
        val = m.group(2).strip()
        if key in fields:
            fields[key] = val
    return fields


def StringIO_lines(text: str):
    return (text or "").splitlines()


def yes(val: str) -> bool:
    return str(val or "").strip().lower() in ("yes", "y", "true", "1", "on")


def resolve_pin(target: str, pin: str) -> str:
    pin = (pin or "auto").strip().lower()
    if pin in ("alpha", "restaurant"):
        return pin
    return "restaurant" if target == "restaurant" else "alpha"


def write_stamp(sha: str, subject: str, date: str = "") -> None:
    """Write the same version code to live-stamp and build-info.

    Manager + boards read TOKI_BUILD. Suite/Deployer read TOKI_LIVE_STAMP.
    One hash, both files, so they cannot disagree after a ship.
    """
    short = sha[:7]
    stamp = {"hash": short, "hashFull": sha, "subject": subject}
    (ROOT / "js" / "live-stamp.js").write_text(
        "window.TOKI_LIVE_STAMP = " + json.dumps(stamp, indent=2) + ";\n",
        encoding="utf-8",
    )
    build = {
        "hash": short,
        "hashFull": sha,
        "date": date or "",
        "subject": subject,
        "source": "git",
    }
    (ROOT / "js" / "build-info.js").write_text(
        "/* Auto-generated — same hash as live-stamp */\n"
        "window.TOKI_BUILD = " + json.dumps(build, indent=2) + ";\n",
        encoding="utf-8",
    )
    pin_version_script_tags(short)


def pin_version_script_tags(short: str) -> None:
    """Bust Pages/browser cache. Frozen ?v=20260808ver1 kept serving 2c31f9b."""
    live_tag = f'<script src="js/live-stamp.js?v={short}"></script>'
    build_tag = f'<script src="js/build-info.js?v={short}"></script>'
    ver_tag = f'<script src="js/version.js?v={short}"></script>'
    for path in sorted(ROOT.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        orig = text
        if "js/build-info.js" in text and "js/live-stamp.js" not in text:
            text = re.sub(
                r'<script src="js/build-info\.js\?v=[^"]+"></script>',
                live_tag + "\n  " + build_tag,
                text,
                count=1,
            )
        if "js/build-info.js" in text and "js/version.js" not in text:
            text = re.sub(
                r'(<script src="js/build-info\.js\?v=[^"]+"></script>)',
                r"\1\n  " + ver_tag,
                text,
                count=1,
            )
        text = VERSION_SCRIPT_RE.sub(rf"\1?v={short}", text)
        if text != orig:
            path.write_text(text, encoding="utf-8")
            print(f"version tags {path.name} v={short}", flush=True)


def plan_text(opts: dict) -> str:
    return "\n".join(
        [
            "### Deployer plan",
            f"- target: `{opts['target']}`",
            f"- source: `{opts['source']}`",
            f"- ship: `{opts['ship']}`",
            f"- pin: `{opts['pin']}` → `{opts['resolved_pin']}`",
            f"- dry-run: `{opts['dry']}`",
            f"- notes: {opts['notes'] or '(none)'}",
        ]
    )


def ship(opts: dict) -> dict:
    target = opts["target"]
    source = opts["source"]
    if target not in ("testing", "restaurant"):
        raise SystemExit(f"bad target: {target}")
    if target == "restaurant" and not opts["confirm"]:
        raise SystemExit("restaurant deploy requires confirm-restaurant: yes")

    run(["git", "fetch", "origin", source], check=False)
    run(["git", "fetch", "origin", target], check=False)
    if run(["git", "rev-parse", "--verify", source], check=False).returncode != 0:
        if run(["git", "rev-parse", "--verify", f"origin/{source}"], check=False).returncode == 0:
            source = f"origin/{source}"
        else:
            raise SystemExit(f"unknown source: {opts['source']}")
    src_sha = git_out(["rev-parse", source])
    src_subject = git_out(["log", "-1", "--format=%s", source])
    has_target = (
        run(["git", "rev-parse", "--verify", f"origin/{target}"], check=False).returncode
        == 0
    )

    if opts["dry"]:
        print(plan_text(opts), flush=True)
        print(f"would merge {source} ({src_sha[:7]}) into {target}", flush=True)
        return {"ok": True, "dry": True, "sha": src_sha, "subject": src_subject}

    if has_target:
        run(["git", "checkout", "-B", target, f"origin/{target}"])
        merge = run(
            ["git", "merge", "--no-ff", source, "-m", f"deploy: merge {source} into {target}"],
            check=False,
        )
        if merge.returncode != 0:
            unmerged = [
                p
                for p in git_out(["diff", "--name-only", "--diff-filter=U"]).splitlines()
                if p.strip()
            ]
            leftover = [p for p in unmerged if p not in GENERATED_SHIP_FILES]
            if leftover or not unmerged:
                run(["git", "merge", "--abort"], check=False)
                raise SystemExit(
                    "merge "
                    + source
                    + " → "
                    + target
                    + " failed"
                    + (": " + ", ".join(leftover) if leftover else "")
                )
            for path in unmerged:
                # ours = target, theirs = source. Stamps are rewritten after merge.
                run(["git", "checkout", "--theirs", "--", path])
                run(["git", "add", "--", path])
            print(
                "resolved generated conflict: "
                + ", ".join(unmerged)
                + " (rewritten after merge)",
                flush=True,
            )
            run(
                [
                    "git",
                    "commit",
                    "--no-edit",
                    "-m",
                    f"deploy: merge {source} into {target}",
                ]
            )
    else:
        run(["git", "checkout", "-B", target, source])

    pin = opts["resolved_pin"]
    testing_api = opts.get("testing_api") or DEFAULT_TESTING_API
    testing_site = opts.get("testing_site") or DEFAULT_TESTING_SITE or testing_api
    write_env.write(
        target,
        testing_site=testing_site,
        testing_api=testing_api,
        default_source=pin,
    )
    src_date = git_out(["log", "-1", "--format=%ci", source])
    write_stamp(src_sha, src_subject, src_date)
    run(["git", "add", "js/env.js", "js/live-stamp.js", "js/build-info.js", "js/version.js"])
    run(["git", "add", "--", *sorted(str(p) for p in ROOT.glob("*.html"))])
    dirty = run(["git", "diff", "--cached", "--quiet"], check=False)
    if dirty.returncode != 0:
        run(
            [
                "git",
                "commit",
                "-m",
                f"deploy: pin {target} env ({pin}) from {src_sha[:7]}",
            ]
        )
    run(["git", "push", "-u", "origin", target])
    out_sha = git_out(["rev-parse", "HEAD"])
    return {"ok": True, "dry": False, "sha": out_sha, "subject": src_subject, "target": target}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--issue-body", default="")
    ap.add_argument("--issue-file", type=Path)
    ap.add_argument("--target")
    ap.add_argument("--source")
    ap.add_argument("--ship", default="both")
    ap.add_argument("--pin", default="auto")
    ap.add_argument("--promote", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirm-restaurant", action="store_true")
    ap.add_argument("--notes", default="")
    ap.add_argument("--testing-api", default=DEFAULT_TESTING_API)
    ap.add_argument("--testing-site", default=DEFAULT_TESTING_SITE)
    ap.add_argument("--plan-only", action="store_true")
    args = ap.parse_args()

    fields = {}
    body = args.issue_body
    if args.issue_file and args.issue_file.is_file():
        body = args.issue_file.read_text(encoding="utf-8")
    if body:
        fields = parse_issue_body(body)

    target = (args.target or fields.get("target") or "").strip().lower()
    source = (args.source or fields.get("source") or "main").strip()
    ship_what = (args.ship or fields.get("ship") or "both").strip().lower()
    pin = (args.pin or fields.get("pin") or "auto").strip().lower()
    promote = args.promote or yes(fields.get("promote", ""))
    dry = args.dry_run or yes(fields.get("dry-run", ""))
    confirm = args.confirm_restaurant or yes(fields.get("confirm-restaurant", ""))
    notes = args.notes or fields.get("notes") or ""
    if promote:
        source = "testing"
        target = target or "restaurant"
    if not target:
        raise SystemExit("missing target")

    opts = {
        "target": target,
        "source": source,
        "ship": ship_what,
        "pin": pin,
        "resolved_pin": resolve_pin(target, pin),
        "dry": dry,
        "confirm": confirm,
        "notes": notes,
        "testing_api": args.testing_api,
        "testing_site": args.testing_site,
    }
    print(plan_text(opts), flush=True)
    if args.plan_only:
        return
    result = ship(opts)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
