#!/usr/bin/env python3
"""Write js/env.js for local / testing / restaurant.

Used by the Deployer GitHub Action and by scripts/cloud-run/deploy.sh.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "js" / "env.js"

RESTAURANT_SITE = "https://olitokip.github.io/OliToki"
RESTAURANT_API = "https://toki-api-3rx5m3qpzq-uc.a.run.app"
RESTAURANT_SOURCE = "restaurant"
TESTING_SOURCE = "alpha"


def render(
    env: str,
    *,
    testing_site: str = "",
    testing_api: str = "",
    default_source: str = "",
    restaurant_site: str = RESTAURANT_SITE,
    restaurant_api: str = RESTAURANT_API,
) -> str:
    env = (env or "local").strip().lower()
    if env not in ("local", "testing", "restaurant"):
        raise SystemExit(f"unknown env: {env}")
    if not default_source:
        if env == "restaurant":
            default_source = RESTAURANT_SOURCE
        elif env == "testing":
            default_source = TESTING_SOURCE
        else:
            default_source = ""
    api_base = restaurant_api
    if env == "testing" and testing_api:
        api_base = testing_api
    elif env == "restaurant":
        api_base = restaurant_api

    def lit(value: str) -> str:
        return json.dumps("" if value is None else str(value), ensure_ascii=False)

    return f"""/**
 * TokiMenu environment pin. Written by scripts/write_env.py / Deployer.
 * Do not hand-edit on restaurant or testing — the next ship overwrites it.
 */
(function (global) {{
  "use strict";
  global.TOKI_ENV = {lit(env)};
  global.TOKI_DEFAULT_SOURCE = {lit(default_source)};
  global.TOKI_RESTAURANT_SITE = {lit(restaurant_site)};
  global.TOKI_RESTAURANT_API = {lit(restaurant_api)};
  global.TOKI_TESTING_SITE = {lit(testing_site)};
  global.TOKI_TESTING_API = {lit(testing_api)};
  global.TOKI_API_BASE = {lit(api_base)};
}})(window);
"""


def write(env: str, **kwargs) -> Path:
    ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENV_PATH.write_text(render(env, **kwargs), encoding="utf-8")
    return ENV_PATH


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--env",
        required=True,
        choices=("local", "testing", "restaurant"),
    )
    ap.add_argument("--testing-site", default="")
    ap.add_argument("--testing-api", default="")
    ap.add_argument("--default-source", default="")
    ap.add_argument("--restaurant-site", default=RESTAURANT_SITE)
    ap.add_argument("--restaurant-api", default=RESTAURANT_API)
    args = ap.parse_args()
    path = write(
        args.env,
        testing_site=args.testing_site,
        testing_api=args.testing_api,
        default_source=args.default_source,
        restaurant_site=args.restaurant_site,
        restaurant_api=args.restaurant_api,
    )
    print(f"wrote {path} env={args.env}", flush=True)


if __name__ == "__main__":
    main()
