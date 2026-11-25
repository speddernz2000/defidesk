// Dependency-free SVG charts.
let uid = 0;
const niceTicks = (min, max, n) => Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));

/** series: [{name,color,pts:[{x,y}]}]; area fill only for a single series. */
export function lineChart(series, { w = 640, h = 190, fmtX = String, fmtY = String, xTicks = 5, yTicks = 4, area = true, legend = false } = {}) {
  const all = series.flatMap((s) => s.pts); if (all.length < 2) return '<div class="muted pad">Not enough data</div>';
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const padY = (y1 - y0) * 0.06; y0 -= padY; y1 += padY;
  const L = 8, R = 62, T = 8, B = 22, W = w - L - R, H = h - T - B;
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * W, Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * H;
  const id = `g${uid++}`;
  let out = `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">`;
  out += `<defs>${series.map((s, i) => `<linearGradient id="${id}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  niceTicks(y0 + padY, y1 - padY, yTicks).forEach((v) => { out += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${w - R + 6}" y="${Y(v) + 4}" class="tick">${fmtY(v)}</text>`; });
  niceTicks(x0, x1, xTicks).forEach((v, i) => { out += `<text x="${X(v)}" y="${h - 6}" class="tick" text-anchor="${i === 0 ? 'start' : i === xTicks - 1 ? 'end' : 'middle'}">${fmtX(v)}</text>`; });
  series.forEach((s, i) => {
    const d = s.pts.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
    if (area && series.length === 1) out += `<path d="${d}L${X(s.pts.at(-1).x)} ${T + H}L${X(s.pts[0].x)} ${T + H}Z" fill="url(#${id}-${i})"/>`;
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} style="filter:drop-shadow(0 0 4px ${s.color})"/>`;
  });
  out += '</svg>';
  if (legend) out += `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
  return out;
}

/** Horizontal price bar: highlighted range, white line = current price, dot = entry price. */
export function rangeBar({ lower, upper, current, entry = null }) {
  const lo = Math.min(lower ?? current * 0.55, current, entry ?? current) * 0.93, hi = Math.max(upper ?? current * 1.45, current, entry ?? current) * 1.07;
  const W = 600, X = (v) => ((v - lo) / (hi - lo)) * W, id = `rb${uid++}`;
  const rs = lower == null ? 0 : X(lower), re = upper == null ? W : X(upper);
  const inRange = (lower == null || current >= lower) && (upper == null || current <= upper);
  const fmt = (v) => '$' + (v >= 100 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2));
  return `<svg viewBox="0 0 ${W} 58" class="rangebar"><defs><linearGradient id="${id}"><stop offset="0" stop-color="#00e5f2" stop-opacity=".6"/><stop offset="1" stop-color="#8c5cf5" stop-opacity=".6"/></linearGradient></defs>
    <rect x="0" y="8" width="${W}" height="26" rx="7" fill="rgba(255,255,255,.06)"/>
    <rect x="${rs}" y="8" width="${Math.max(re - rs, 2)}" height="26" rx="7" fill="url(#${id})"/>
    ${entry != null ? `<circle cx="${X(entry)}" cy="21" r="4" fill="rgba(255,255,255,.85)"/>` : ''}
    <rect x="${X(current) - 1}" y="1" width="2.5" height="40" fill="${inRange ? '#fff' : '#ff4d73'}"/>
    <text x="0" y="55" class="tick">${lower == null ? '0' : fmt(lower)}</text>
    <text x="${Math.min(Math.max(X(current), 40), W - 40)}" y="55" class="tick strong" text-anchor="middle">${fmt(current)}</text>
    <text x="${W}" y="55" class="tick" text-anchor="end">${upper == null ? '∞' : fmt(upper)}</text></svg>`;
}
