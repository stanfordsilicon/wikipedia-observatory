#!/usr/bin/env python3
"""
Build an IDLI-oriented dataset of standalone Wikipedia editions.

Sources:
1. Wikimedia SiteMatrix API
2. MediaWiki siteinfo API for each Wikipedia
3. Wikimedia Analytics pageviews API
4. MediaWiki languageinfo API
5. Local ISO 639-3 registry files

Expected ISO file:
    scripts/iso-639-3.tab   (download once, see scripts/README.md)

Outputs (dated so each run is preserved as its own snapshot, matching the
Observatory's "track over time" data model -- NOT overwritten each run):
    data/wikipedia_idli_data_YYYY-MM-DD.csv
    data/wikipedia_idli_data_YYYY-MM-DD.json
    data/wikipedia_idli_unresolved_language_mappings_YYYY-MM-DD.csv

Originally written by Tom (Wikipedia IDLI connector). Patched by Anya for
the Wikipedia Observatory: dated snapshot output + cron-friendly defaults
(--iso-639-3 and --output now have defaults so a scheduled job doesn't need
extra flags). Core data-fetching logic is unchanged.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests


SITEMATRIX_API = "https://meta.wikimedia.org/w/api.php"
LANGUAGEINFO_API = "https://meta.wikimedia.org/w/api.php"
PAGEVIEWS_BASE = (
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate"
)

USER_AGENT = (
    "SILICON-IDLI-Wikipedia-Connector/1.0 "
    "(https://silicon.stanford.edu; tsmullaney@stanford.edu)"
)

REQUEST_DELAY_SECONDS = 0.10
TIMEOUT_SECONDS = 60

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
}

WIKIMEDIA_ISO_OVERRIDES: dict[str, dict[str, str]] = {
    "simple": {
        "iso_639_3": "eng",
        "mapping_type": "project_variant",
        "mapping_note": "Simple English Wikipedia; maps to English.",
    },
    "be-tarask": {
        "iso_639_3": "bel",
        "mapping_type": "orthographic_variant",
        "mapping_note": "Belarusian in Taraskievica orthography.",
    },
    "zh-min-nan": {
        "iso_639_3": "nan",
        "mapping_type": "historical_wikimedia_code",
        "mapping_note": "Southern Min; historical Wikimedia code.",
    },
    "bat-smg": {
        "iso_639_3": "sgs",
        "mapping_type": "historical_wikimedia_code",
        "mapping_note": "Samogitian; historical Wikimedia code.",
    },
    "fiu-vro": {
        "iso_639_3": "vro",
        "mapping_type": "historical_wikimedia_code",
        "mapping_note": "Võro; historical Wikimedia code.",
    },
    "roa-rup": {
        "iso_639_3": "rup",
        "mapping_type": "historical_wikimedia_code",
        "mapping_note": "Aromanian; historical Wikimedia code.",
    },
    "roa-tara": {
        "iso_639_3": "nap",
        "mapping_type": "variety_mapping",
        "mapping_note": (
            "Tarantino is commonly treated as a Neapolitan variety; "
            "review for IDLI before treating as one-to-one."
        ),
    },
    "map-bms": {
        "iso_639_3": "jav",
        "mapping_type": "variety_mapping",
        "mapping_note": (
            "Banyumasan is generally classified within Javanese; "
            "review before treating as one-to-one."
        ),
    },
    "nds-nl": {
        "iso_639_3": "nds",
        "mapping_type": "regional_variant",
        "mapping_note": "Dutch Low Saxon edition.",
    },
    "cbk-zam": {
        "iso_639_3": "cbk",
        "mapping_type": "regional_variety",
        "mapping_note": "Chavacano de Zamboanga.",
    },
}


OUTPUT_FIELDS = [
    "wikimedia_language_code",
    "bcp47_tag",
    "bcp47_primary_language",
    "iso_639_1",
    "iso_639_2_bibliographic",
    "iso_639_2_terminologic",
    "iso_639_3",
    "iso_scope",
    "iso_language_type",
    "iso_reference_name",
    "mapping_type",
    "mapping_confidence",
    "mapping_note",
    "language_name_english",
    "language_name_native",
    "wikipedia_url",
    "api_url",
    "analytics_project",
    "database_name",
    "site_name",
    "status",
    "is_active",
    "is_closed",
    "article_count",
    "total_pages",
    "total_edits",
    "registered_users",
    "active_users",
    "administrators",
    "files_local",
    "pageviews_30_days",
    "pageviews_365_days",
    "pageviews_30_start",
    "pageviews_30_end",
    "pageviews_365_start",
    "pageviews_365_end",
    "date_established",
    "date_established_source",
    "statistics_retrieved_at_utc",
    "pageviews_retrieved_at_utc",
    "connector_error",
]


def request_json(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = 4,
) -> dict[str, Any]:
    """Make a polite GET request with retries and exponential backoff."""

    last_error: Exception | None = None

    for attempt in range(attempts):
        try:
            response = session.get(
                url,
                params=params,
                timeout=TIMEOUT_SECONDS,
            )

            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue

            response.raise_for_status()
            return response.json()

        except (requests.RequestException, ValueError) as error:
            last_error = error

            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
            else:
                break

    raise RuntimeError(f"Request failed for {url}: {last_error}")


def load_iso_639_3(
    iso_path: Path,
) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Load the SIL ISO 639-3 tab-delimited registry."""

    records_by_iso3: dict[str, dict[str, str]] = {}
    any_code_to_iso3: dict[str, str] = {}

    with iso_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")

        fieldnames = reader.fieldnames or []

        header_lookup = {
            field.strip().lower(): field
            for field in fieldnames
            if field
        }

        required_headers = {
            "id": "Id",
            "part2b": "Part2b",
            "part2t": "Part2t",
            "part1": "Part1",
            "scope": "Scope",
            "language_type": "Language_Type",
            "ref_name": "Ref_Name",
        }

        missing = [
            expected_name
            for normalized_name, expected_name in required_headers.items()
            if normalized_name not in header_lookup
        ]

        if missing:
            raise ValueError(
                "ISO file is missing required columns: "
                f"{missing}. Found columns: {fieldnames}"
            )

        id_column = header_lookup["id"]
        part2b_column = header_lookup["part2b"]
        part2t_column = header_lookup["part2t"]
        part1_column = header_lookup["part1"]
        scope_column = header_lookup["scope"]
        language_type_column = header_lookup["language_type"]
        ref_name_column = header_lookup["ref_name"]

        for row in reader:
            iso3 = (row.get(id_column) or "").strip()

            if not iso3:
                continue

            normalized = {
                "iso_639_3": iso3,
                "iso_639_2_bibliographic": (
                    row.get(part2b_column) or ""
                ).strip(),
                "iso_639_2_terminologic": (
                    row.get(part2t_column) or ""
                ).strip(),
                "iso_639_1": (
                    row.get(part1_column) or ""
                ).strip(),
                "iso_scope": (
                    row.get(scope_column) or ""
                ).strip(),
                "iso_language_type": (
                    row.get(language_type_column) or ""
                ).strip(),
                "iso_reference_name": (
                    row.get(ref_name_column) or ""
                ).strip(),
            }

            records_by_iso3[iso3] = normalized

            for code in (
                iso3,
                normalized["iso_639_1"],
                normalized["iso_639_2_bibliographic"],
                normalized["iso_639_2_terminologic"],
            ):
                if code:
                    any_code_to_iso3[code.lower()] = iso3

    return records_by_iso3, any_code_to_iso3


def fetch_languageinfo(
    session: requests.Session,
) -> dict[str, dict[str, Any]]:
    """Retrieve MediaWiki language code, BCP 47 tag, and names."""

    language_info: dict[str, dict[str, Any]] = {}
    continue_value: str | None = None

    while True:
        params: dict[str, Any] = {
            "action": "query",
            "meta": "languageinfo",
            "liprop": "code|bcp47|autonym|name",
            "licode": "*",
            "uselang": "en",
            "format": "json",
            "formatversion": "2",
        }

        if continue_value:
            params["licontinue"] = continue_value

        payload = request_json(
            session,
            LANGUAGEINFO_API,
            params=params,
        )

        for code, info in payload.get("query", {}).get(
            "languageinfo", {}
        ).items():
            language_info[code] = info

        continuation = payload.get("continue", {})
        continue_value = continuation.get("licontinue")

        if not continue_value:
            break

    return language_info


def fetch_wikipedia_editions(
    session: requests.Session,
) -> list[dict[str, Any]]:
    """Get all standalone Wikipedia editions from SiteMatrix."""

    params = {
        "action": "sitematrix",
        "format": "json",
        "formatversion": "2",
    }

    payload = request_json(session, SITEMATRIX_API, params=params)
    matrix = payload["sitematrix"]

    records: list[dict[str, Any]] = []

    for key, language_group in matrix.items():
        if not str(key).isdigit():
            continue

        wiki_code = language_group.get("code", "")

        for site in language_group.get("site", []):
            if site.get("code") != "wiki":
                continue

            url = site.get("url", "")

            if "wikipedia.org" not in url:
                continue

            is_closed = "closed" in site
            is_private = "private" in site
            is_fishbowl = "fishbowl" in site

            if is_closed:
                status = "closed"
            elif is_private:
                status = "private"
            elif is_fishbowl:
                status = "fishbowl"
            else:
                status = "active"

            hostname = urlparse(url).hostname or ""
            analytics_project = hostname.removesuffix(".org")

            records.append(
                {
                    "wikimedia_language_code": wiki_code,
                    "language_name_english": language_group.get(
                        "name", ""
                    ),
                    "language_name_native": language_group.get(
                        "localname", ""
                    ),
                    "wikipedia_url": url,
                    "api_url": f"{url}/w/api.php",
                    "analytics_project": analytics_project,
                    "database_name": site.get("dbname", ""),
                    "site_name": site.get("sitename", ""),
                    "status": status,
                    "is_active": status == "active",
                    "is_closed": is_closed,
                }
            )

    return records


def map_to_iso(
    wiki_code: str,
    bcp47_tag: str,
    records_by_iso3: dict[str, dict[str, str]],
    any_code_to_iso3: dict[str, str],
) -> dict[str, str]:
    """Map Wikimedia/BCP 47 language identifiers to ISO 639-3."""

    empty = {
        "iso_639_1": "",
        "iso_639_2_bibliographic": "",
        "iso_639_2_terminologic": "",
        "iso_639_3": "",
        "iso_scope": "",
        "iso_language_type": "",
        "iso_reference_name": "",
        "mapping_type": "unresolved",
        "mapping_confidence": "low",
        "mapping_note": "",
    }

    override = WIKIMEDIA_ISO_OVERRIDES.get(wiki_code)

    if override:
        iso3 = override["iso_639_3"]
        iso_record = records_by_iso3.get(iso3, {})

        return {
            **empty,
            **iso_record,
            "mapping_type": override["mapping_type"],
            "mapping_confidence": "high",
            "mapping_note": override["mapping_note"],
        }

    primary = bcp47_tag.split("-")[0].lower() if bcp47_tag else ""

    iso3 = any_code_to_iso3.get(primary)

    if not iso3:
        return {
            **empty,
            "mapping_note": (
                f"No ISO 639-3 mapping found for BCP 47 primary "
                f"subtag '{primary}'."
            ),
        }

    iso_record = records_by_iso3[iso3]

    mapping_type = (
        "direct_iso_639_3"
        if primary == iso3
        else "iso_registry_crosswalk"
    )

    return {
        **empty,
        **iso_record,
        "mapping_type": mapping_type,
        "mapping_confidence": "high",
    }


def fetch_site_statistics(
    session: requests.Session,
    api_url: str,
) -> dict[str, int]:
    """Retrieve current project statistics."""

    params = {
        "action": "query",
        "meta": "siteinfo",
        "siprop": "statistics",
        "format": "json",
        "formatversion": "2",
    }

    payload = request_json(session, api_url, params=params)
    stats = payload["query"]["statistics"]

    return {
        "article_count": int(stats.get("articles", 0)),
        "total_pages": int(stats.get("pages", 0)),
        "total_edits": int(stats.get("edits", 0)),
        "registered_users": int(stats.get("users", 0)),
        "active_users": int(stats.get("activeusers", 0)),
        "administrators": int(stats.get("admins", 0)),
        "files_local": int(stats.get("images", 0)),
    }


def analytics_timestamp(value: date) -> str:
    """Format date as YYYYMMDD00 for the Wikimedia Analytics API."""

    return value.strftime("%Y%m%d00")


def fetch_pageviews(
    session: requests.Session,
    project: str,
    start_date: date,
    end_date: date,
) -> int:
    """Sum human-oriented project pageviews over a date range."""

    url = (
        f"{PAGEVIEWS_BASE}/{project}/"
        f"all-access/user/daily/"
        f"{analytics_timestamp(start_date)}/"
        f"{analytics_timestamp(end_date)}"
    )

    payload = request_json(session, url)

    return sum(
        int(item.get("views", 0))
        for item in payload.get("items", [])
    )


def calculate_date_ranges() -> dict[str, date]:
    """Calculate complete trailing periods, excluding today (incomplete)."""

    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)

    return {
        "end": yesterday,
        "start_30": yesterday - timedelta(days=29),
        "start_365": yesterday - timedelta(days=364),
    }


def blank_metrics() -> dict[str, Any]:
    return {
        "article_count": "",
        "total_pages": "",
        "total_edits": "",
        "registered_users": "",
        "active_users": "",
        "administrators": "",
        "files_local": "",
        "pageviews_30_days": "",
        "pageviews_365_days": "",
    }


def enrich_record(
    session: requests.Session,
    record: dict[str, Any],
    language_info: dict[str, dict[str, Any]],
    records_by_iso3: dict[str, dict[str, str]],
    any_code_to_iso3: dict[str, str],
    ranges: dict[str, date],
) -> dict[str, Any]:
    """Add language mappings, statistics, and pageviews."""

    now = datetime.now(timezone.utc).isoformat()
    wiki_code = record["wikimedia_language_code"]

    info = language_info.get(wiki_code, {})
    bcp47_tag = info.get("bcp47", wiki_code)
    bcp47_primary = bcp47_tag.split("-")[0] if bcp47_tag else ""

    iso_mapping = map_to_iso(
        wiki_code,
        bcp47_tag,
        records_by_iso3,
        any_code_to_iso3,
    )

    enriched = {
        **record,
        "bcp47_tag": bcp47_tag,
        "bcp47_primary_language": bcp47_primary,
        **iso_mapping,
        **blank_metrics(),
        "pageviews_30_start": ranges["start_30"].isoformat(),
        "pageviews_30_end": ranges["end"].isoformat(),
        "pageviews_365_start": ranges["start_365"].isoformat(),
        "pageviews_365_end": ranges["end"].isoformat(),
        "date_established": "",
        "date_established_source": "",
        "statistics_retrieved_at_utc": "",
        "pageviews_retrieved_at_utc": "",
        "connector_error": "",
    }

    if not record["is_active"]:
        return enriched

    errors: list[str] = []

    try:
        enriched.update(
            fetch_site_statistics(session, record["api_url"])
        )
        enriched["statistics_retrieved_at_utc"] = now
    except Exception as error:
        errors.append(f"siteinfo: {error}")

    time.sleep(REQUEST_DELAY_SECONDS)

    try:
        enriched["pageviews_30_days"] = fetch_pageviews(
            session,
            record["analytics_project"],
            ranges["start_30"],
            ranges["end"],
        )
    except Exception as error:
        errors.append(f"pageviews_30: {error}")

    time.sleep(REQUEST_DELAY_SECONDS)

    try:
        enriched["pageviews_365_days"] = fetch_pageviews(
            session,
            record["analytics_project"],
            ranges["start_365"],
            ranges["end"],
        )
        enriched["pageviews_retrieved_at_utc"] = now
    except Exception as error:
        errors.append(f"pageviews_365: {error}")

    enriched["connector_error"] = " | ".join(errors)

    return enriched


def write_csv(
    records: list[dict[str, Any]],
    output_path: Path,
    fields: list[str] = OUTPUT_FIELDS,
) -> None:
    with output_path.open(
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fields,
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(records)


def write_json(
    records: list[dict[str, Any]],
    output_path: Path,
) -> None:
    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "sources": [
            "Wikimedia SiteMatrix API",
            "MediaWiki siteinfo API",
            "MediaWiki languageinfo API",
            "Wikimedia Analytics Pageviews API",
            "ISO 639-3 registry",
        ],
        "record_count": len(records),
        "records": records,
    }

    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser()

    default_iso_path = Path(__file__).resolve().parent / "iso-639-3.tab"
    default_output_dir = Path(__file__).resolve().parent.parent / "data"

    parser.add_argument(
        "--iso-639-3",
        type=Path,
        default=default_iso_path,
        help=(
            "Path to iso-639-3.tab. Defaults to scripts/iso-639-3.tab "
            "(download once from the SIL ISO 639-3 registry and commit it "
            "-- it rarely changes -- so scheduled/cron runs don't need to "
            "fetch it every time)."
        ),
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=default_output_dir,
        help="Output directory. Defaults to the project's /data folder.",
    )

    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not args.iso_639_3.exists():
        logging.error(
            "ISO 639-3 file not found at %s. Download it from "
            "https://iso639-3.sil.org/code_tables/download_tables and "
            "place it there (see scripts/README.md).",
            args.iso_639_3,
        )
        return 1

    session = requests.Session()
    session.headers.update(HEADERS)

    records_by_iso3, any_code_to_iso3 = load_iso_639_3(
        args.iso_639_3
    )

    logging.info("Downloading MediaWiki language mappings")
    language_info = fetch_languageinfo(session)

    logging.info("Downloading Wikipedia edition list")
    editions = fetch_wikipedia_editions(session)

    ranges = calculate_date_ranges()
    enriched_records: list[dict[str, Any]] = []

    for index, edition in enumerate(editions, start=1):
        logging.info(
            "[%s/%s] %s",
            index,
            len(editions),
            edition["wikimedia_language_code"],
        )

        enriched = enrich_record(
            session,
            edition,
            language_info,
            records_by_iso3,
            any_code_to_iso3,
            ranges,
        )
        enriched_records.append(enriched)

        time.sleep(REQUEST_DELAY_SECONDS)

    enriched_records.sort(
        key=lambda row: (
            not row["is_active"],
            -int(row["article_count"] or 0),
            row["wikimedia_language_code"],
        )
    )

    unresolved = [
        row
        for row in enriched_records
        if not row["iso_639_3"]
    ]

    today = date.today().isoformat()

    write_csv(
        enriched_records,
        args.output / f"wikipedia_idli_data_{today}.csv",
    )

    write_json(
        enriched_records,
        args.output / f"wikipedia_idli_data_{today}.json",
    )

    write_csv(
        unresolved,
        args.output / f"wikipedia_idli_unresolved_language_mappings_{today}.csv",
    )

    print()
    print(f"Wikipedia editions: {len(enriched_records):,}")
    print(
        "Active editions: "
        f"{sum(bool(r['is_active']) for r in enriched_records):,}"
    )
    print(f"Unresolved ISO mappings: {len(unresolved):,}")
    print(f"Output directory: {args.output.resolve()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
