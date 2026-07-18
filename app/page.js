import { loadAllSnapshots, marketOverview, distinctDates } from "../lib/data";
import Ticker from "../components/Ticker";
import Board from "../components/Board";

function formatNum(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export default function Home() {
  const records = loadAllSnapshots();
  const dates = distinctDates(records);
  const overview = marketOverview(records, "articles");

  const totals = overview.reduce(
    (acc, r) => {
      acc.articles += r.value || 0;
      return acc;
    },
    { articles: 0 }
  );

  const totalEdits = records
    .filter((r) => dates.length && r.date === dates[dates.length - 1])
    .reduce((sum, r) => sum + (r.edits || 0), 0);

  const totalActive = records
    .filter((r) => dates.length && r.date === dates[dates.length - 1])
    .reduce((sum, r) => sum + (r.activeusers || 0), 0);

  const advancing = overview.filter((r) => r.change > 0).length;
  const declining = overview.filter((r) => r.change < 0).length;

  const movers = overview
    .filter((r) => r.pctChange != null)
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
    .slice(0, 16);

  const hasData = records.length > 0;

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div className="eyebrow">Wikipedia Observatory</div>
          <h1>The encyclopedia, charted.</h1>
          <p className="hero-sub">
            Every active Wikipedia language edition, tracked like a market —
            articles, edits, contributors, and pageviews, measured against
            the previous snapshot.
          </p>
        </div>
      </header>

      <Ticker movers={movers} />

      {!hasData ? (
        <div className="empty-state">
          <p className="mono">
            No snapshot data found in <code>/data</code>. Run{" "}
            <code>python scripts/fetch_wikipedia_stats.py</code> at least
            once (after placing <code>iso-639-3.tab</code> in{" "}
            <code>scripts/</code>) to generate a{" "}
            <code>wikipedia_idli_data_YYYY-MM-DD.csv</code> file, commit it,
            and redeploy.
          </p>
        </div>
      ) : (
        <>
          <section className="ledger">
            <div className="stat-card">
              <div className="eyebrow">Editions tracked</div>
              <div className="stat-value mono">{formatNum(overview.length)}</div>
            </div>
            <div className="stat-card">
              <div className="eyebrow">Total articles</div>
              <div className="stat-value mono">{formatNum(totals.articles)}</div>
            </div>
            <div className="stat-card">
              <div className="eyebrow">Total edits</div>
              <div className="stat-value mono">{formatNum(totalEdits)}</div>
            </div>
            <div className="stat-card">
              <div className="eyebrow">Active contributors</div>
              <div className="stat-value mono">{formatNum(totalActive)}</div>
            </div>
            <div className="stat-card">
              <div className="eyebrow">Advancing / declining</div>
              <div className="stat-value mono">
                <span className="positive">{advancing}</span>
                {" / "}
                <span className="negative">{declining}</span>
              </div>
            </div>
          </section>

          <section className="index-section">
            <div className="section-heading">
              <span className="eyebrow">The Index</span>
            </div>
            <Board records={records} />
          </section>
        </>
      )}

      <footer className="site-footer">
        <div>Source: Wikimedia API (siteinfo statistics, per language edition)</div>
        {dates.length > 0 && (
          <div>Snapshots: {dates.join(" · ")}</div>
        )}
      </footer>

      <style>{`
        main {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0 0 64px;
        }
        .hero {
          padding: 56px 24px 28px;
        }
        .hero-inner {
          max-width: 720px;
        }
        h1 {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 42px;
          line-height: 1.1;
          margin: 14px 0 16px;
          letter-spacing: -0.01em;
        }
        .hero-sub {
          color: var(--text-muted);
          font-size: 16px;
          line-height: 1.55;
          margin: 0;
          max-width: 560px;
        }
        .empty-state {
          margin: 40px 24px;
          padding: 24px;
          border: 1px dashed var(--border);
          border-radius: var(--radius);
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.7;
        }
        .empty-state code {
          background: var(--surface-2);
          padding: 1px 6px;
          border-radius: 2px;
          font-family: var(--font-mono);
        }
        .ledger {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 1px;
          background: var(--border);
          margin: 32px 24px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          overflow: hidden;
        }
        .stat-card {
          background: var(--surface);
          padding: 18px 20px;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 600;
          margin-top: 8px;
        }
        .index-section {
          margin: 48px 24px 0;
        }
        .section-heading {
          margin-bottom: 14px;
        }
        .site-footer {
          margin: 56px 24px 0;
          padding-top: 20px;
          border-top: 1px solid var(--border);
          color: var(--text-faint);
          font-size: 12px;
          font-family: var(--font-mono);
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
        }

        @media (max-width: 900px) {
          .ledger {
            grid-template-columns: repeat(2, 1fr);
          }
          h1 {
            font-size: 32px;
          }
        }
      `}</style>
    </main>
  );
}
