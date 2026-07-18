"use client";

import { useMemo, useState } from "react";
import { marketOverview, METRIC_COLUMNS, metricLabel } from "../lib/metrics";
import Sparkline from "./Sparkline";

function formatNum(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function formatPct(n) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function changeClass(n) {
  if (n == null) return "neutral";
  return n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
}

export default function Board({ records }) {
  const [metric, setMetric] = useState("articles");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("value");
  const [sortDir, setSortDir] = useState("desc");

  const overview = useMemo(() => marketOverview(records, metric), [records, metric]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = overview;
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.language || "").toLowerCase().includes(q) ||
          (r.code || "").toLowerCase().includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "language") {
        av = (av || "").toLowerCase();
        bv = (bv || "").toLowerCase();
        return sortDir === "asc" ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [overview, query, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({ label, sortByKey, align = "right" }) {
    const active = sortKey === sortByKey;
    return (
      <th
        onClick={() => toggleSort(sortByKey)}
        className={`sortable ${align === "right" ? "num-col" : ""}`}
      >
        {label}
        <span className="sort-arrow">{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</span>
      </th>
    );
  }

  return (
    <section className="board">
      <div className="board-controls">
        <div className="control-group">
          <label className="eyebrow" htmlFor="metric-select">
            Metric
          </label>
          <select
            id="metric-select"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            {METRIC_COLUMNS.map((m) => (
              <option key={m} value={m}>
                {metricLabel(m)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group grow">
          <label className="eyebrow" htmlFor="search-box">
            Search
          </label>
          <input
            id="search-box"
            type="text"
            placeholder="Filter by language name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="count-note mono">
          {filtered.length} of {overview.length} editions
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortHeader label="Edition" sortByKey="language" align="left" />
              <th className="num-col">Trend</th>
              <SortHeader label={metricLabel(metric)} sortByKey="value" />
              <SortHeader label="Change" sortByKey="change" />
              <SortHeader label="% Change" sortByKey="pctChange" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.code}>
                <td>
                  <div className="lang-name">{row.language || row.code}</div>
                  <div className="lang-code mono neutral">
                    {row.code}
                    {row.iso639_3 ? ` · ISO ${row.iso639_3}` : ""}
                  </div>
                </td>
                <td className="num-col">
                  <Sparkline history={row.history} />
                </td>
                <td className="num-col mono">{formatNum(row.value)}</td>
                <td className={`num-col mono ${changeClass(row.change)}`}>
                  {row.change == null ? "—" : (row.change > 0 ? "+" : "") + formatNum(row.change)}
                </td>
                <td className={`num-col mono ${changeClass(row.pctChange)}`}>
                  {formatPct(row.pctChange)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  No editions match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .board {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .board-controls {
          display: flex;
          align-items: flex-end;
          gap: 24px;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .control-group.grow {
          flex: 1;
          min-width: 220px;
        }
        .board-controls select,
        .board-controls input {
          background: var(--surface-2);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: var(--font-body);
          font-size: 14px;
          padding: 8px 10px;
          border-radius: var(--radius);
          min-width: 200px;
        }
        .board-controls input {
          min-width: 260px;
        }
        .count-note {
          color: var(--text-faint);
          font-size: 12px;
          margin-left: auto;
          padding-bottom: 9px;
        }
        .table-wrap {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        thead th {
          text-align: right;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-faint);
          padding: 10px 16px;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
        }
        thead th:first-child {
          text-align: left;
        }
        thead th:hover {
          color: var(--gold);
        }
        .sort-arrow {
          color: var(--gold);
        }
        tbody td {
          padding: 10px 16px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        tbody tr:hover {
          background: var(--surface-2);
        }
        .num-col {
          text-align: right;
        }
        .lang-name {
          font-weight: 500;
        }
        .lang-code {
          font-size: 11px;
          margin-top: 2px;
        }
        .empty-row {
          text-align: center;
          color: var(--text-faint);
          padding: 32px 16px;
        }
      `}</style>
    </section>
  );
}
