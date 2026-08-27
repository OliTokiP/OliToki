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
# HTML ?v= pins conflict the same way (manager.html aborted three restaurant ships).
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
        "dispatched": "no",
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


GITHUB_REPO = "OliTokiP/OliToki"
GITHUB_USER = "OliTokiP"
_GH_BIN_CANDIDATES = ("/usr/local/bin/gh", "/opt/homebrew/bin/gh")
_gh_token_cache: str | None = None
_gh_bin_cache: str | None = None


def _gh_bin() -> str:
    """Suite App's toki_server PATH often lacks Homebrew. Do not rely on which() alone."""
    global _gh_bin_cache
    if _gh_bin_cache:
        return _gh_bin_cache
    import shutil

    for p in _GH_BIN_CANDIDATES:
        if Path(p).is_file() and os.access(p, os.X_OK):
            _gh_bin_cache = p
            return p
    found = shutil.which("gh")
    if found:
        _gh_bin_cache = found
        return found
    raise RuntimeError(
        "GitHub CLI (gh) is not installed. On this Mac: brew install gh"
    )


def _git_quiet(args: list[str]) -> str:
    r = subprocess.run(
        ["git"] + args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def _gh_env() -> dict:
    """Pin GitHub CLI to OliTokiP. Never print the token."""
    global _gh_token_cache
    env = os.environ.copy()
    env["GH_PROMPT_DISABLED"] = "1"
    extra = "/usr/local/bin:/opt/homebrew/bin"
    env["PATH"] = extra + ":" + (env.get("PATH") or "")
    if not _gh_token_cache:
        try:
            r = subprocess.run(
                [_gh_bin(), "auth", "token", "--user", GITHUB_USER],
                capture_output=True,
                text=True,
                timeout=8,
                env=env,
            )
        except FileNotFoundError as e:
            raise RuntimeError(
                "GitHub CLI (gh) is not installed. On this Mac: brew install gh"
            ) from e
        token = (r.stdout or "").strip()
        if r.returncode != 0 or not token:
            raise RuntimeError(
                "GitHub CLI is not signed in as OliTokiP. On this Mac: gh auth login"
            )
        _gh_token_cache = token
    env["GH_TOKEN"] = _gh_token_cache
    return env


def _gh_api(
    path: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    timeout: int = 30,
):
    args = [_gh_bin(), "api", path]
    if method != "GET":
        args.extend(["-X", method])
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
        "env": _gh_env(),
    }
    if payload is not None:
        args.extend(["--input", "-"])
        kwargs["input"] = json.dumps(payload)
    try:
        r = subprocess.run(args, **kwargs)
    except FileNotFoundError as e:
        raise RuntimeError(
            "GitHub CLI (gh) is not installed. On this Mac: brew install gh"
        ) from e
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "gh api failed").strip()
        raise RuntimeError(err[:500])
    raw = (r.stdout or "").strip()
    if not raw:
        return {}
    return json.loads(raw)


def github_commit_page(sha: str = "") -> str:
    sha = (sha or "").strip()
    if not sha:
        return f"https://github.com/{GITHUB_REPO}/commits/main"
    return f"https://github.com/{GITHUB_REPO}/commit/{sha}"


def latest_commit_info(ref: str = "main") -> dict:
    ref = (ref or "main").strip() or "main"
    sha = _git_quiet(["rev-parse", "--verify", ref])
    if not sha:
        sha = _git_quiet(["rev-parse", "--verify", f"origin/{ref}"])
        ref = f"origin/{ref}" if sha else ref
    subject = _git_quiet(["log", "-1", "--format=%s", ref]) if sha else ""
    return {
        "hash": sha[:7] if sha else "",
        "hashFull": sha,
        "subject": subject,
        "url": github_commit_page(sha),
    }


def commit_info_for_source(source: str) -> dict:
    source = (source or "main").strip() or "main"
    info = latest_commit_info(source)
    if info.get("hashFull"):
        return info
    if re.fullmatch(r"[0-9a-fA-F]{7,40}", source):
        return {
            "hash": source[:7],
            "hashFull": source,
            "subject": "",
            "url": github_commit_page(source),
        }
    return latest_commit_info("main")


def github_status() -> dict:
    """Local Deployer probe: latest main commit + whether we can file issues."""
    commit = latest_commit_info("main")
    latest_issue = None
    user = ""
    error = ""
    gh_ok = False
    try:
        me = _gh_api("user")
        user = str((me or {}).get("login") or "")
        gh_ok = user.lower() == GITHUB_USER.lower()
        if not gh_ok:
            error = (
                "GitHub CLI is signed in as "
                + (user or "someone else")
                + ", not OliTokiP"
            )
        rows = _gh_api(
            f"repos/{GITHUB_REPO}/issues?labels=toki-deploy&state=all&per_page=1"
        )
        if isinstance(rows, list) and rows:
            it = rows[0] or {}
            latest_issue = {
                "number": it.get("number"),
                "title": it.get("title") or "",
                "url": it.get("html_url") or "",
            }
    except Exception as e:
        error = str(e)
        gh_ok = False
    return {
        "ok": gh_ok,
        "local": True,
        "user": user,
        "commit": commit,
        "latestIssue": latest_issue,
        "error": error,
    }


def issue_payload(fields: dict) -> dict:
    target = str(fields.get("target") or "").strip().lower()
    ship = str(fields.get("ship") or "both").strip().lower()
    source = str(fields.get("source") or "main").strip()
    pin = str(fields.get("pin") or "auto").strip().lower()
    promote = yes(fields.get("promote"))
    dry = yes(fields.get("dry") or fields.get("dry-run"))
    confirm = yes(fields.get("confirm") or fields.get("confirm-restaurant"))
    notes = str(fields.get("notes") or "").strip()
    if promote:
        source = "testing"
    if target not in ("testing", "restaurant"):
        raise ValueError("target must be testing or restaurant")
    if ship not in ("both", "website", "api"):
        raise ValueError("ship must be both, website, or api")
    if pin not in ("auto", "alpha", "restaurant"):
        raise ValueError("pin must be auto, alpha, or restaurant")
    if not source:
        raise ValueError("missing source")
    if target == "restaurant" and not confirm:
        raise ValueError(
            "Check “I am shipping to the dining room” for a restaurant deploy."
        )
    title = ("Dry run: " if dry else "Deploy: ") + source + " → " + target
    body = "\n".join(
        [
            "### toki-deploy",
            "- target: " + target,
            "- ship: " + ship,
            "- source: " + source,
            "- pin: " + pin,
            "- promote: " + ("yes" if promote else "no"),
            "- dry-run: " + ("yes" if dry else "no"),
            "- confirm-restaurant: " + ("yes" if confirm else "no"),
            "- notes: " + (notes or "(none)"),
        ]
    )
    if yes(fields.get("dispatched")):
        body += "\n- dispatched: yes"
    return {
        "title": title,
        "body": body,
        "target": target,
        "source": source,
        "ship": ship,
        "pin": pin,
        "promote": promote,
        "dry": dry,
        "confirm": confirm,
        "notes": notes,
    }


def dispatch_workflow(fields: dict) -> None:
    """Start deploy.yml from the Mac. One click should not also need the issue event."""
    f = fields or {}
    target = str(f.get("target") or "testing").strip().lower() or "testing"
    source = str(f.get("source") or "main").strip() or "main"
    ship = str(f.get("ship") or "both").strip().lower() or "both"
    pin = str(f.get("pin") or "auto").strip().lower() or "auto"
    dry = "true" if yes(f.get("dry") or f.get("dry-run")) else "false"
    confirm = "true" if yes(f.get("confirm") or f.get("confirm-restaurant")) else "false"
    notes = str(f.get("notes") or "")
    args = [
        _gh_bin(),
        "workflow",
        "run",
        "deploy.yml",
        "--repo",
        GITHUB_REPO,
        "--ref",
        "main",
        "-f",
        "target=" + target,
        "-f",
        "source=" + source,
        "-f",
        "ship=" + ship,
        "-f",
        "pin=" + pin,
        "-f",
        "dry_run=" + dry,
        "-f",
        "confirm_restaurant=" + confirm,
        "-f",
        "notes=" + notes,
    ]
    r = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=20,
        env=_gh_env(),
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "workflow dispatch failed").strip()
        raise RuntimeError(err[:500])


def file_deploy_issue(fields: dict) -> dict:
    """Create the toki-deploy GitHub issue. Does not ship; Actions does."""
    built = issue_payload(fields)
    created = _gh_api(
        f"repos/{GITHUB_REPO}/issues",
        method="POST",
        payload={
            "title": built["title"],
            "body": built["body"],
            "labels": ["toki-deploy"],
        },
    )
    if not isinstance(created, dict) or not created.get("html_url"):
        raise RuntimeError("GitHub did not return an issue URL")
    return {
        "ok": True,
        "issueNumber": created.get("number"),
        "issueUrl": created.get("html_url"),
        "title": built["title"],
        "commit": commit_info_for_source(built["source"]),
    }


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
            "- method: publish source onto target (no merge)",
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

    if opts["dry"]:
        print(
            f"would publish {source} ({src_sha[:7]}) onto {target} "
            "(force-with-lease that branch only; never main)",
            flush=True,
        )
        return {"ok": True, "dry": True, "sha": src_sha, "subject": src_subject}

    # restaurant/testing are publish branches: the ship IS the source tree, then
    # env/stamp pins. Merging two pin-rewritten trees is what aborted restaurant
    # after confirm-restaurant: yes (manager.html ?v=). Do not merge.
    run(["git", "checkout", "-B", target, src_sha])
    print(f"publish {src_sha[:7]} onto {target}", flush=True)

    pin = opts["resolved_pin"]
    testing_api = opts.get("testing_api") or DEFAULT_TESTING_API
    testing_site = opts.get("testing_site") or DEFAULT_TESTING_SITE or testing_api
    write_env.write(
        target,
        testing_site=testing_site,
        testing_api=testing_api,
        default_source=pin,
    )
    src_date = git_out(["log", "-1", "--format=%ci", src_sha])
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
    # Publish branch only. Never --force main. Lease fails if another ship won.
    push = run(
        ["git", "push", "--force-with-lease", "-u", "origin", target],
        check=False,
    )
    if push.returncode != 0:
        raise SystemExit(
            "push "
            + target
            + " failed (force-with-lease). Another ship may have landed; retry."
        )
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
