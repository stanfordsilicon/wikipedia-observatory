// lib/metrics.js
//
// Pure functions with no Node dependencies -- safe to import from both
// Server Components and Client Components. Filesystem access lives
// separately in lib/data.js (server only).
//
// Metric columns here mirror Tom's IDLI connector output (article_count,
// total_edits, pageviews_30_days, etc.), remapped during ingestion in
// lib/data.js into these shorter internal names.

export const METRIC_COLUMNS = [
  "pages",
  "articles",
  "edits",
  "images",
  "users",
  "activeusers",
  "admins",
  "pageviews30",
  "pageviews365",
];

export const DEFAULT_METRIC = "articles";

const METRIC_LABELS = {
  pages: "Pages",
  articles: "Articles",
  edits: "Edits",
  images: "Images",
  users: "Registered users",
  activeusers: "Active users",
  admins: "Admins",
  pageviews30: "Pageviews (30d)",
  pageviews365: "Pageviews (365d)",
};

export function metricLabel(metric) {
  return METRIC_LABELS[metric] || metric;
}

/** Stock-ticker-style board: one row per language edition with its latest
 * value, change since the previous snapshot, and % change, for a given
 * metric. Sorted by latest value descending. Only active editions (not
 * closed/private/fishbowl) are included -- those don't have a reachable
 * statistics API and would just show blanks. */
export function marketOverview(records, metric = DEFAULT_METRIC) {
  const byCode = new Map();
  for (const rec of records) {
    if (rec.isActive === false) continue;
    if (!byCode.has(rec.code)) byCode.set(rec.code, []);
    byCode.get(rec.code).push(rec);
  }

  const rows = [];
  for (const [code, snapshots] of byCode) {
    const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;

    const latestVal = latest[metric];
    const prevVal = prev ? prev[metric] : null;
    const change =
      latestVal != null && prevVal != null ? latestVal - prevVal : null;
    const pctChange =
      change != null && prevVal ? (change / prevVal) * 100 : null;

    rows.push({
      code,
      language: latest.language,
      url: latest.url,
      iso639_3: latest.iso639_3,
      isoRefName: latest.isoRefName,
      latestDate: latest.date,
      value: latestVal,
      change,
      pctChange,
      snapshotsAvailable: sorted.length,
      history: sorted.map((s) => ({ date: s.date, value: s[metric] })),
    });
  }

  rows.sort((a, b) => {
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return b.value - a.value;
  });
  return rows;
}

export function distinctDates(records) {
  return Array.from(new Set(records.map((r) => r.date))).sort();
}

export function timeSeriesFor(records, code) {
  return records
    .filter((r) => r.code === code)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
