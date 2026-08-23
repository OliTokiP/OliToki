#!/usr/bin/env python3
"""Post macOS Notification Center banners as Suite.

Health (toki_server), Listener, and Deployer all call this so banners
use the Suite icon and group under Suite — never Script Editor / osascript
with the title “Toki Menu”.

When native Suite.app (`local.toki.suite.app`) is running, we send a
distributed notification and Suite itself delivers the banner. Click
opens the matching hub page. If Suite is not running, fall back to an
NSUserNotification stamped with the Suite identity image.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SUITE_BUNDLE_NATIVE = "local.toki.suite.app"
SUITE_BUNDLE_WRAPPER = "local.toki.suite"
NOTIFY_NAME = "local.toki.suite.notify"
ROOT = Path(__file__).resolve().parents[1]
NATIVE_SUITE = (
    Path.home()
    / "Library/Mobile Documents/com~apple~CloudDocs/2026/OliTokiDev/Suite.app"
)


def _darwin() -> bool:
    return sys.platform == "darwin"


def suite_icon_path() -> Path | None:
    cands = [
        NATIVE_SUITE / "Contents" / "Resources" / "AppIcon.icns",
        ROOT / "Suite.app" / "Contents" / "Resources" / "AppIcon.icns",
        ROOT / "Open Toki Menus.app" / "Contents" / "Resources" / "AppIcon.icns",
        Path.home()
        / "Library/Mobile Documents/iCloud~md~obsidian/Documents/OliToki Menu"
        / "Listener"
        / "Toki Listener.app"
        / "Contents"
        / "Resources"
        / "AppIcon.icns",
    ]
    for p in cands:
        if p.is_file():
            return p
    return None


def suite_app_running() -> bool:
    if not _darwin():
        return False
    try:
        from AppKit import NSRunningApplication

        apps = NSRunningApplication.runningApplicationsWithBundleIdentifier_(
            SUITE_BUNDLE_NATIVE
        )
        return bool(apps)
    except Exception:
        pass
    try:
        r = subprocess.run(
            [
                "osascript",
                "-e",
                'tell application "System Events" to '
                "(exists (first process whose bundle identifier is "
                f'"{SUITE_BUNDLE_NATIVE}"))',
            ],
            capture_output=True,
            text=True,
            timeout=4,
        )
        return (r.stdout or "").strip().lower() == "true"
    except Exception:
        return False


def _post_distributed(user_info: dict[str, str]) -> bool:
    try:
        from Foundation import NSDistributedNotificationCenter

        center = NSDistributedNotificationCenter.defaultCenter()
        center.postNotificationName_object_userInfo_deliverImmediately_(
            NOTIFY_NAME, None, user_info, True
        )
        return True
    except Exception:
        pass
    try:
        payload = json.dumps(user_info, ensure_ascii=True)
        js = r"""
ObjC.import('Foundation');
function run(argv) {
  var raw = argv[0] || '{}';
  var obj = JSON.parse(raw);
  var info = $.NSMutableDictionary.dictionary;
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v === undefined || v === null || v === '') return;
    info.setObjectForKey($(String(v)), $(String(k)));
  });
  $.NSDistributedNotificationCenter.defaultCenter
    .postNotificationNameObjectUserInfoDeliverImmediately(
      $('""" + NOTIFY_NAME + r"""'),
      null,
      info,
      true
    );
}
"""
        r = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", js, "--", payload],
            capture_output=True,
            text=True,
            timeout=6,
        )
        return r.returncode == 0
    except Exception:
        return False


def post_to_suite_app(
    title: str,
    body: str = "",
    *,
    subtitle: str = "",
    open_url: str = "",
    tag: str = "",
) -> bool:
    """Ask the running native Suite.app to deliver the banner. No-op if it is down."""
    if not _darwin() or not suite_app_running():
        return False
    info = {
        "title": (title or "").strip() or "Suite",
        "subtitle": (subtitle or "").strip(),
        "body": (body or "").strip(),
        "url": (open_url or "").strip(),
        "tag": (tag or "").strip(),
    }
    return _post_distributed(info)


def _fallback_ns(
    title: str,
    body: str,
    *,
    subtitle: str = "",
    open_url: str = "",
) -> bool:
    try:
        from AppKit import (
            NSImage,
            NSUserNotification,
            NSUserNotificationCenter,
            NSUserNotificationDefaultSoundName,
        )
    except Exception:
        return False
    note = NSUserNotification.alloc().init()
    note.setTitle_((title or "").strip() or "Suite")
    if subtitle:
        try:
            note.setSubtitle_(subtitle)
        except Exception:
            pass
    if body:
        note.setInformativeText_(body)
    note.setSoundName_(NSUserNotificationDefaultSoundName)
    info = {}
    if open_url:
        info["url"] = open_url
        try:
            note.setHasActionButton_(True)
            note.setActionButtonTitle_("Open")
        except Exception:
            pass
    if info:
        note.setUserInfo_(info)
    icon = suite_icon_path()
    if icon:
        img = NSImage.alloc().initWithContentsOfFile_(str(icon))
        if img is not None:
            try:
                note._setIdentityImage_withIdentifier_(img, SUITE_BUNDLE_NATIVE)
            except Exception:
                try:
                    note.set_identityImage_(img)
                except Exception:
                    pass
    NSUserNotificationCenter.defaultUserNotificationCenter().deliverNotification_(
        note
    )
    return True


def notify(
    title: str,
    body: str = "",
    *,
    subtitle: str = "",
    open_url: str = "",
    tag: str = "",
) -> bool:
    """Post a Suite-branded Notification Center banner. Darwin only."""
    if not _darwin():
        return False
    title = (title or "").strip() or "Suite"
    body = (body or "").strip()
    subtitle = (subtitle or "").strip()
    open_url = (open_url or "").strip()
    tag = (tag or "").strip()
    if post_to_suite_app(
        title, body, subtitle=subtitle, open_url=open_url, tag=tag
    ):
        return True
    return _fallback_ns(title, body, subtitle=subtitle, open_url=open_url)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Suite Notification Center ping")
    ap.add_argument("--title", default="Suite")
    ap.add_argument("--body", default="")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--url", default="")
    ap.add_argument("--tag", default="")
    args = ap.parse_args(argv)
    ok = notify(
        args.title,
        args.body,
        subtitle=args.subtitle,
        open_url=args.url,
        tag=args.tag,
    )
    print("ok" if ok else "failed", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
