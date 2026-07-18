// lib/data.js
//
// Server-only ingestion: reads every dated snapshot CSV in /data (from
// Tom's IDLI connector script) and merges them into one long (tidy) table.
// Uses Node's fs module, so this file must only be imported from Server
// Components or route handlers, never from a "use client" component.
//
// Tom's script outputs columns like wikimedia_language_code, article_count,
// total_edits, pageviews_30_days, iso_639_3, is_active, etc. This layer
// translates those into the shorter internal field names the rest of the
// app (lib/metrics.js, components/) already expects: code, language, url,
// date, articles, edits, pages, users, activeusers, admins, images,
// pageviews30, pageviews365, isActive, iso639_3, isoRefName.

import fs from "fs";
import path from "path";

export {
  METRIC_COLUMNS,
  DEFAULT_METRIC,
  metricLabel,
  marketOverview,
  distinctDates,
  timeSeriesFor,
} from "./metrics";

const DATA_DIR = path.join(process.cwd(), "data");

/** Minimal RFC-4180-ish CSV parser: handles quoted fields containing
 * commas, without pulling in a dependency for something this small. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length === header.length && r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function dateFromFilename(filename) {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toNum(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Translate one raw row from Tom's schema into the app's internal shape. */
function mapRow(raw, fallbackDate) {
  const code = raw.wikimedia_language_code;
  if (!code) return null;

  // statistics_retrieved_at_utc is a full timestamp and may be blank for
  // rows where that API call failed -- the filename date is the reliable
  // anchor for which snapshot batch a row belongs to.
  const date = fallbackDate;

  return {
    date,
    code,
    language: raw.language_name_english || code,
    url: raw.wikipedia_url,
    isActive: raw.is_active === "True" || raw.is_active === "true",
    iso639_3: raw.iso_639_3 || null,
    isoRefName: raw.iso_reference_name || null,
    pages: toNum(raw.total_pages),
    articles: toNum(raw.article_count),
    edits: toNum(raw.total_edits),
    users: toNum(raw.registered_users),
    activeusers: toNum(raw.active_users),
    admins: toNum(raw.administrators),
    images: toNum(raw.files_local),
    pageviews30: toNum(raw.pageviews_30_days),
    pageviews365: toNum(raw.pageviews_365_days),
  };
}

/** Reads every wikipedia_idli_data_*.csv in /data (Tom's dated snapshot
 * output) and returns one long array of records in the app's internal
 * shape, deduplicated on (code, date) -- last file for a given date wins
 * if a date was ever re-run. */
export function loadAllSnapshots() {
  let files = [];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("wikipedia_idli_data_") && f.endsWith(".csv"))
      .sort();
  } catch {
    return [];
  }

  const byKey = new Map();

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    let text;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rawRecords = parseCsv(text);
    const fallbackDate = dateFromFilename(file);
    if (!fallbackDate) continue;

    for (const raw of rawRecords) {
      const rec = mapRow(raw, fallbackDate);
      if (!rec) continue;
      byKey.set(`${rec.code}::${rec.date}`, rec);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.date < b.date ? -1 : 1;
  });
}
