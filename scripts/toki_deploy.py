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

DEFAULT_TESTING_API = os.environ.get("TOKI_TESTING_API", "").strip()
DEFAULT_TESTING_SITE = os.environ.get("TOKI_TESTING_SITE", "").strip()
RESTAURANT_SITE = "https://olitokip.github.io/OliToki"
RESTAURANT_API = "https://toki-api-3rx5m3qpzq-uc.a.run.app"


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


def write_stamp(sha: str, subject: str) -> None:
    dest = ROOT / "js" / "live-stamp.js"
    dest.write_text(
        "window.TOKI_LIVE_STAMP = "
        + json.dumps(
            {
                "hash": sha[:7],
                "hashFull": sha,
                "subject": subject,
            },
            indent=2,
        )
        + ";\n",
        encoding="utf-8",
    )


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
            run(["git", "merge", "--abort"], check=False)
            raise SystemExit(f"merge {source} → {target} failed")
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
    write_stamp(src_sha, src_subject)
    run(["git", "add", "js/env.js", "js/live-stamp.js"])
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
