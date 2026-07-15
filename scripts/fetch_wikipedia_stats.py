"""
fetch_wikipedia_stats.py

Downloads current statistics for every active Wikipedia language edition and
saves them as a dated CSV snapshot in ../data/.

Run this on whatever cadence you like (daily, weekly, whenever). Each run
produces one new file named:

    data/wikipedia_stats_YYYY-MM-DD.csv

The viewer app automatically picks up any new snapshot files dropped into
data/ -- no other wiring required. This mirrors the Keyman project's
three-dates-so-far setup, just for Wikipedia.

Data sources (both public, read-only MediaWiki API endpoints):
  1. meta.wikimedia.org "sitematrix" API -> list of all Wikipedia language
     editions (code, language name, url, whether it's closed/private).
  2. Each individual wiki's own API, action=query&meta=siteinfo&siprop=statistics
     -> pages, articles, edits, images, users, activeusers, admins, jobs.

Usage:
    python fetch_wikipedia_stats.py
    python fetch_wikipedia_stats.py --out-dir ../data --sleep 1.0

Note: Wikimedia's API will rate-limit (HTTP 429) if requests come in too
fast across many different wiki subdomains. The script retries individual
429s with backoff, and does a second full pass over anything that still
failed at the end. If you still see failures after that, try increasing
--sleep (e.g. --sleep 2.0) and running again.
"""

import argparse
import csv
import datetime as dt
import sys
import time
from pathlib import Path

import requests

SITEMATRIX_URL = "https://meta.wikimedia.org/w/api.php"
USER_AGENT = "wikipedia-stock-viewer/1.0 (educational project; contact: set-your-email-here)"

STAT_FIELDS = [
    "pages",
    "articles",
    "edits",
    "images",
    "users",
    "activeusers",
    "admins",
    "jobs",
]


def get_wikipedia_sites():
    """Return list of dicts: {code, language, url} for every ACTIVE, public
    Wikipedia (skips closed wikis and non-Wikipedia sister projects)."""
    params = {
        "action": "sitematrix",
        "format": "json",
        "smtype": "language",
        "smlangprop": "code|name|site",
    }
    resp = requests.get(SITEMATRIX_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    sites = []
    matrix = data.get("sitematrix", {})
    for key, entry in matrix.items():
        if key == "count":
            continue
        if isinstance(entry, dict) and "site" in entry:
            lang_code = entry.get("code")
            lang_name = entry.get("name") or entry.get("localname")
            for site in entry["site"]:
                if site.get("code") != "wiki":
                    continue  # skip wiktionary, wikinews, etc. -- Wikipedia only
                if site.get("closed") is not None:
                    continue  # skip closed/dormant wikis
                sites.append(
                    {
                        "code": lang_code,
                        "language": lang_name,
                        "url": site.get("url"),
                    }
                )
    return sites


def get_site_statistics(site_url, max_retries=5):
    """Query one wiki's own API for its statistics block.

    Wikimedia's API rate-limits aggressively if requests come in too fast
    across hundreds of different wiki subdomains. If we get a 429, back off
    and retry rather than giving up on that language edition.
    """
    api_url = site_url.rstrip("/") + "/w/api.php"
    params = {
        "action": "query",
        "format": "json",
        "meta": "siteinfo",
        "siprop": "statistics",
    }

    for attempt in range(max_retries):
        resp = requests.get(api_url, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
        if resp.status_code == 429:
            wait = float(resp.headers.get("Retry-After", 5 * (attempt + 1)))
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        return data.get("query", {}).get("statistics", {})

    # Ran out of retries -- raise so the caller logs it as a failed edition.
    resp.raise_for_status()
    return {}


def main():
    parser = argparse.ArgumentParser(description="Fetch current Wikipedia stats for all language editions.")
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent.parent / "data"))
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to wait between requests (be polite to the API).")
    parser.add_argument("--limit", type=int, default=None, help="Optional cap on number of wikis, useful for a quick test run.")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    today = dt.date.today().isoformat()
    out_path = out_dir / f"wikipedia_stats_{today}.csv"

    print("Fetching list of active Wikipedia language editions...")
    sites = get_wikipedia_sites()
    if args.limit:
        sites = sites[: args.limit]
    print(f"Found {len(sites)} active Wikipedia editions. Fetching statistics...")

    fieldnames = ["date", "code", "language", "url"] + STAT_FIELDS
    rows = []
    errors = []

    def fetch_one(site):
        stats = get_site_statistics(site["url"])
        return {
            "date": today,
            "code": site["code"],
            "language": site["language"],
            "url": site["url"],
            **{field: stats.get(field, "") for field in STAT_FIELDS},
        }

    failed_sites = []
    for i, site in enumerate(sites, start=1):
        try:
            rows.append(fetch_one(site))
        except Exception:  # noqa: BLE001 - log and keep going
            failed_sites.append(site)
        finally:
            if i % 25 == 0 or i == len(sites):
                print(f"  {i}/{len(sites)} done")
            time.sleep(args.sleep)

    # Second pass: retry anything that failed once, now that the API has had
    # a chance to cool off.
    if failed_sites:
        print(f"\nRetrying {len(failed_sites)} edition(s) that failed on the first pass...")
        still_failed = []
        for site in failed_sites:
            try:
                rows.append(fetch_one(site))
            except Exception as e:  # noqa: BLE001
                still_failed.append((site["code"], str(e)))
            time.sleep(max(args.sleep, 2.0))
        errors = still_failed

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved {len(rows)} rows to {out_path}")
    if errors:
        print(f"{len(errors)} editions failed to fetch (network hiccups / API quirks):")
        for code, msg in errors[:10]:
            print(f"  - {code}: {msg}")
        if len(errors) > 10:
            print(f"  ...and {len(errors) - 10} more")


if __name__ == "__main__":
    sys.exit(main())
