# scripts/

## One-time setup: ISO 639-3 registry file

Tom's connector script (`fetch_wikipedia_stats.py`) maps each Wikipedia
language edition to its ISO 639-3 code, which requires a local copy of the
SIL ISO 639-3 registry. This file changes rarely, so it's downloaded once
and committed to the repo rather than fetched on every run.

1. Go to https://iso639-3.sil.org/code_tables/download_tables
2. Download the "Complete Code Tables" zip (UTF-8 tab-delimited)
3. Unzip it and find `iso-639-3.tab` inside
4. Place that file at `scripts/iso-639-3.tab` in this repo
5. Commit it:
   ```
   git add scripts/iso-639-3.tab
   git commit -m "Add ISO 639-3 registry file"
   git push
   ```

After that, both local runs and the scheduled GitHub Actions workflow will
find it automatically (`fetch_wikipedia_stats.py` defaults to
`scripts/iso-639-3.tab`).

## Running manually

```bash
pip install -r requirements.txt
python fetch_wikipedia_stats.py
```

Writes dated snapshots to `../data/`:
- `wikipedia_idli_data_YYYY-MM-DD.csv` (read by the app)
- `wikipedia_idli_data_YYYY-MM-DD.json` (same data, JSON form)
- `wikipedia_idli_unresolved_language_mappings_YYYY-MM-DD.csv` (editions
  that couldn't be matched to an ISO 639-3 code, for review)

## Automated daily runs

See `.github/workflows/daily-wikipedia-fetch.yml` — GitHub Actions runs
this script once a day, commits the new snapshot, and pushes. That push
triggers Vercel to redeploy automatically. See the main README for the
one-time repo setting you need to enable ("Read and write permissions" for
Actions) before this will work.
