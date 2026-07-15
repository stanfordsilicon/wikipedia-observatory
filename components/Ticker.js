// components/Ticker.js
// Pure CSS marquee -- no client JS needed. Duplicates the item list once
// so the loop is seamless.

function TickerItem({ item }) {
  const up = item.pctChange > 0;
  const down = item.pctChange < 0;
  const arrow = up ? "▲" : down ? "▼" : "•";
  const cls = up ? "positive" : down ? "negative" : "neutral";

  return (
    <span className="ticker-item mono">
      <span className="ticker-code">{item.code}</span>
      <span className={cls}>
        {" "}
        {arrow} {item.pctChange > 0 ? "+" : ""}
        {item.pctChange.toFixed(1)}%
      </span>
      <span className="ticker-sep">·</span>
    </span>
  );
}

export default function Ticker({ movers }) {
  if (!movers || movers.length === 0) {
    return (
      <div className="ticker-empty mono">
        awaiting a second snapshot to compute movement — run the fetch
        script again on a different day
      </div>
    );
  }

  return (
    <div className="ticker-wrap">
      <div className="ticker-track">
        {movers.map((m) => (
          <TickerItem key={`a-${m.code}`} item={m} />
        ))}
        {movers.map((m) => (
          <TickerItem key={`b-${m.code}`} item={m} />
        ))}
      </div>

      <style>{`
        .ticker-wrap {
          overflow: hidden;
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          white-space: nowrap;
        }
        .ticker-track {
          display: inline-flex;
          align-items: center;
          padding: 10px 0;
          animation: ticker-scroll 42s linear infinite;
        }
        .ticker-wrap:hover .ticker-track {
          animation-play-state: paused;
        }
        .ticker-item {
          display: inline-flex;
          align-items: center;
          font-size: 13px;
          padding: 0 14px;
        }
        .ticker-code {
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .ticker-sep {
          color: var(--text-faint);
          margin-left: 14px;
        }
        .ticker-empty {
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-faint);
          font-size: 12px;
          padding: 12px 24px;
        }
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
