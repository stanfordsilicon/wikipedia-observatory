// lib/data.js
//
// Server-only ingestion: reads every dated snapshot CSV in /data and
// merges them into one long (tidy) table. Uses Node's fs module, so this
// file must only be imported from Server Components or route handlers,
// never from a "use client" component.

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

const METRIC_COLUMNS_LOCAL = [
  "pages",
  "articles",
  "edits",
  "images",
  "users",
  "activeusers",
  "admins",
  "jobs",
];

/** Reads every wikipedia_stats_*.csv in /data and returns one long array
 * of records, deduplicated on (code, date) -- last file for a given date
 * wins if a date was ever re-run. */
export function loadAllSnapshots() {
  let files = [];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("wikipedia_stats_") && f.endsWith(".csv"))
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
    const records = parseCsv(text);
    const fallbackDate = dateFromFilename(file);

    for (const rec of records) {
      const date = rec.date || fallbackDate;
      if (!date || !rec.code) continue;

      const parsed = { ...rec, date };
      for (const col of METRIC_COLUMNS_LOCAL) {
        const n = Number(rec[col]);
        parsed[col] = Number.isFinite(n) ? n : null;
      }
      byKey.set(`${rec.code}::${date}`, parsed);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.date < b.date ? -1 : 1;
  });
}
