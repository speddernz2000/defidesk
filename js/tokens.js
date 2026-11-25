// Tokens tab: BTC & ETH prices with timeframe charts.
import { h, usd, pct, cls, ago, on } from './util.js';
import { S, TF, setTF, loadHistory } from './state.js';
import { lineChart } from './charts.js';

const fmtX = (tf) => (v) => {
  const d = new Date(v);
  if (tf === '24H') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '1Y') return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  if (tf === '5Y') return String(d.getFullYear());
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const compact = (v) => usd(v, true);
const axisUSD = (v) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 2 : 0 });

export function mount(root) {
  const seg = h('div', { class: 'seg' });
  const banners = h('div');
  const cards = h('div', { class: 'stack' });
  const foot = h('div', { class: 'muted small' });
  root.append(h('div', { class: 'row' }, seg, h('span', { class: 'spacer' })), banners, cards, foot);

  function card(c) {
    const pts = (S.history[`${c.id}:${TF[S.tf]}`] || []).map((p) => ({ x: p.t, y: p.p }));
    const first = pts[0]?.y, last = pts.at(-1)?.y;
    const periodChange = first && last ? (last / first - 1) * 100 : null;
    const up = (periodChange ?? 0) >= 0;
    const lo = pts.length ? Math.min(...pts.map((p) => p.y)) : null, hi = pts.length ? Math.max(...pts.map((p) => p.y)) : null;
    const accent = c.id === 'bitcoin' ? 'var(--btc)' : 'var(--eth)';
    const stat = (l, v, k) => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: k }, v));
    return h('div', { class: 'card', style: { '--glow': accent } },
      h('div', { class: 'split' },
        h('div', { class: 'col' },
          h('div', {}, h('b', { class: 'big-name' }, c.name), ' ', h('span', { class: 'sym', style: { color: accent } }, c.symbol)),
          h('div', { class: 'price' }, usd(c.price)),
          h('div', { class: 'row gap' }, stat(S.tf, pct(periodChange), cls(periodChange)), stat('24h', pct(c.change24h), cls(c.change24h)), stat('7d', pct(c.change7d), cls(c.change7d))),
          h('hr'),
          h('div', { class: 'kv' },
            h('span', {}, `${S.tf} high`), h('b', {}, pts.length ? usd(hi) : '—'),
            h('span', {}, `${S.tf} low`), h('b', {}, pts.length ? usd(lo) : '—'),
            h('span', {}, 'Market cap'), h('b', {}, compact(c.marketCap)),
            h('span', {}, '24h volume'), h('b', {}, compact(c.volume24h)))),
        h('div', { class: 'chartbox' },
          h('div', { class: 'muted small' }, { '24H': 'Last 24 hours', '7D': 'Last 7 days', '30D': 'Last 30 days', '90D': 'Last 90 days', '1Y': 'Last year', '5Y': 'Last 5 years' }[S.tf]),
          pts.length ? h('div', { html: lineChart([{ name: c.symbol, color: up ? '#22f2a0' : '#ff4d73', pts }], { fmtX: fmtX(S.tf), fmtY: axisUSD }) })
                     : h('div', { class: 'center pad muted' }, S.historyErr ? 'Chart unavailable — retrying…' : 'Loading chart…'))));
  }

  function render() {
    seg.replaceChildren(...Object.keys(TF).map((k) => h('button', { class: k === S.tf ? 'on' : '', onclick: () => setTF(k) }, k)));
    banners.replaceChildren(
      S.coinsError ? h('div', { class: 'banner' }, S.coinsError) : null,
      S.historyErr ? h('div', { class: 'banner' }, `Chart: ${S.historyErr}`) : null);
    cards.replaceChildren(...(S.coins.length ? S.coins.map(card) : [h('div', { class: 'center pad muted' }, S.coinsError ? '' : 'Loading prices…')]));
    foot.textContent = `Updated ${ago(S.coinsUpdated)} · prices refresh every minute · data: ${S.coinsSource}${S.coinsSource === 'Coinbase' ? ' (CoinGecko is limiting requests right now)' : ''}`;
  }
  on('coins', render); on('history', render);
  render();
  return { show() { loadHistory(); render(); } };
}
