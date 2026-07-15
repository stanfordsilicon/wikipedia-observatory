// components/Sparkline.js
export default function Sparkline({ history = [] }) {
  const vals = history.map((h) => h.value).filter((v) => v != null);
  if (vals.length < 2) {
    return <span className="neutral mono">—</span>;
  }

  const w = 72;
  const h = 24;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 4) + 2;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return [x, y];
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const rising = vals[vals.length - 1] >= vals[0];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={rising ? "var(--positive)" : "var(--negative)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
