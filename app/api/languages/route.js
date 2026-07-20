import { loadAllSnapshots, marketOverview } from "../../../lib/data";

// GET /api/languages
//
// One row per active Wikipedia language edition with its latest article
// count and change since the previous snapshot. iso639_3 is populated by
// Tom's IDLI connector for all but a couple of unresolved editions (see
// data/wikipedia_idli_unresolved_language_mappings_*.csv). Powers the
// world-languages-portal's cross-app language lookup.
export async function GET() {
  const rows = marketOverview(loadAllSnapshots(), "articles");
  const languages = rows.map((r) => ({
    code: r.code,
    iso639_3: r.iso639_3,
    language: r.language,
    url: r.url,
    articles: r.value,
    change: r.change,
    pctChange: r.pctChange,
  }));
  return Response.json({ languages });
}
