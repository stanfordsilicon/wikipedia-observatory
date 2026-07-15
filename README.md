# Wikipedia Observatory

Every active Wikipedia language edition, tracked like a market — articles,
edits, and active contributors, measured against the previous snapshot.
Same architecture pattern as the Keyman viewer, rebuilt as a deployable
Next.js app so it can live on Vercel the same way.

```
Python fetch script  -->  dated CSV snapshots in /data  -->  Next.js app reads & merges them at request time
```

## 1. Get a snapshot of data

You need Python + the `requests` library for this part (separate from the
Node/Next.js app itself):

```bash
cd scripts
pip3 install -r requirements.txt
python3 fetch_wikipedia_stats.py
cd ..
```

This writes `data/wikipedia_stats_YYYY-MM-DD.csv` — stats for every active
Wikipedia language edition. Run it again on a different day to get a second
snapshot; the app needs at least two dated files before it can show any
change/% change numbers.

> If you see `429 Too Many Requests` errors, the script already retries
> automatically with backoff and does a second pass at the end — but if a
> lot still fail, re-run with `python3 fetch_wikipedia_stats.py --sleep 2.0`
> to slow it down further.

## 2. Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## 3. Deploy to Vercel

This does **not** require any of Dawson's Keyman infrastructure — it's a
fully independent project. All you need:

1. Push this folder to a new GitHub repo (commit the CSVs in `data/` too —
   that's how the deployed site gets its data, no server or database
   needed).
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click
   **Add New → Project**, and import the repo.
3. Vercel auto-detects Next.js — just click **Deploy**. No config needed.
4. You'll get a URL like `your-project-name.vercel.app`.

### Updating the live site with new data

Whenever you run the fetch script again and get a new dated CSV:

```bash
git add data/
git commit -m "Add wikipedia_stats_YYYY-MM-DD.csv snapshot"
git push
```

Vercel automatically redeploys on every push to the main branch — that's
the entire "auto-ingest future snapshots" workflow. No code changes needed
as the dataset grows.

## Project layout

```
wikipedia-observatory/
├── README.md
├── package.json
├── data/                          # dated CSV snapshots, committed to git
├── scripts/
│   ├── fetch_wikipedia_stats.py   # the Python script that downloads stats
│   └── requirements.txt
├── lib/
│   ├── data.js                    # server-only: reads/merges CSVs from /data
│   └── metrics.js                 # pure functions: market overview, sorting, etc.
├── components/
│   ├── Ticker.js                  # scrolling top-movers marquee
│   ├── Board.js                   # searchable/sortable table (client component)
│   └── Sparkline.js               # inline per-row trend chart
└── app/
    ├── layout.js
    ├── page.js                    # assembles header, ticker, stat cards, board
    └── globals.css                # design tokens
```

## Notes on the metrics

Wikipedia's stats (`articles`, `edits`, `users`, etc.) are cumulative
totals reported live by each wiki, not a rolling window like Keyman's
monthly-download figure — so a straight diff between two snapshots already
gives the true change over that period. No reverse-engineering step is
needed here the way it is for Keyman's rolling 30-day download counter.
