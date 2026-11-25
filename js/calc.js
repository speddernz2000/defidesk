// Calculator tab: simulate an LP position (default: largest ETH/USD pool on Base).
import { h, usd, pct, cls, on } from './util.js';
import { S, ethPrice, paperPoolAPR, paperSigma, loadStats } from './state.js';
import { topPoolsCached, paperInfo, version } from './api.js';
import { Position, simulate, estimateAPR } from './math.js';
import { lineChart } from './charts.js';

function slider(label, min, max, step, value, fmt, onInput) {
  const val = h('span', { class: 'mono small' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.value = value;
  input.addEventListener('input', () => { val.textContent = fmt(+input.value); onInput(+input.value); });
  return { el: h('div', { class: 'field' }, h('div', { class: 'split small' }, h('span', { class: 'lbl' }, label), val), input), input, val };
}

export function mount(root) {
  let capital = 100, days = 30, move = 0, apr = 0, aprTouched = false, rangeMode = 0, rangePct = 25, poolId = '';
  let candidates = [], loadingPool = true, poolErr = '';

  const poolSel = h('select', { onchange: () => { poolId = poolSel.value; aprTouched = false; pickPool(); } });
  const capIn = h('input', { type: 'number', value: capital, min: 0, step: 'any', oninput: () => { capital = Math.max(+capIn.value || 0, 0.01); update(); } });
  const daysS = slider('Hold period', 1, 365, 1, days, (v) => `${v} days`, (v) => { days = v; update(); });
  const moveS = slider('Price change', -80, 200, 1, move, (v) => `${v >= 0 ? '+' : ''}${v}%`, (v) => { move = v; update(); });
  const aprS = slider('Pool average fee APR', 0, 400, 1, apr, (v) => `${v}%`, (v) => { apr = v; aprTouched = true; update(); });
  const rangeS = slider('Range around entry', 2, 90, 1, rangePct, (v) => `±${v}%`, (v) => { rangePct = v; update(); });
  const rangeBox = h('div', { class: 'field' }, rangeS.el);
  const modeSeg = h('div', { class: 'seg' });
  const poolInfo = h('div', { class: 'muted small' });
  const note = h('div', { class: 'muted small' });
  const inputs = h('div', { class: 'card stack', style: { '--glow': 'var(--cyan)' } },
    h('div', { class: 'eyebrow' }, 'SIMULATE POSITION'),
    h('div', { class: 'field' }, h('div', { class: 'lbl small' }, 'Pool'), poolSel, poolInfo),
    h('div', { class: 'field' }, h('div', { class: 'lbl small' }, 'Investment (USD)'), capIn),
    daysS.el, moveS.el, aprS.el,
    h('div', { class: 'muted small' }, "Defaults to the pool's recent fees ÷ liquidity. Past volume doesn't predict future volume."),
    modeSeg, rangeBox, note);
  const results = h('div', { class: 'stack' });
  root.append(h('div', { class: 'two' }, inputs, results));

  const pool = () => candidates.find((p) => p.id === poolId);
  const entry = () => paperInfo(pool() || {})?.price || ethPrice() || 2000;
  const sigma = () => (pool() ? paperSigma(pool()) : 0.035);
  const position = () => {
    const p0 = entry();
    return rangeMode === 0 ? new Position(capital, p0) : new Position(capital, p0, p0 * (1 - rangePct / 100), p0 * (1 + rangePct / 100));
  };

  function update() {
    modeSeg.replaceChildren(
      h('button', { class: rangeMode === 0 ? 'on' : '', onclick: () => { rangeMode = 0; update(); } }, 'Full range'),
      h('button', { class: rangeMode === 1 ? 'on' : '', onclick: () => { rangeMode = 1; update(); } }, 'Concentrated'));
    rangeBox.style.display = rangeMode === 1 ? '' : 'none';
    const p0 = entry(), pos = position();
    note.textContent = `Entry price ${usd(p0)} (live)` + (rangeMode === 1 ? ` · range ${usd(p0 * (1 - rangePct / 100))} – ${usd(p0 * (1 + rangePct / 100))}` : '');
    if (rangeMode === 1) { const e = estimateAPR(apr, pos.lower, pos.upper, p0, sigma()); note.textContent += ` · this range earns ~${e.whileInRange.toFixed(0)}% APR while in range (${(e.timeInRange * 100).toFixed(0)}% of the time)`; }
    const r = simulate(pos, apr, sigma(), days, move / 100), pnl = r.lpTotal - capital;
    const ethShare = pos.amounts(r.endPrice); const share = (ethShare.volatile * r.endPrice) / Math.max(pos.value(r.endPrice), 1e-9);
    const stat = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
    const summary = h('div', { class: 'card', style: { '--glow': 'var(--violet)' } },
      h('div', { class: 'big-name' }, pool() ? `${pool().name} · ${version(pool())}` : '—'),
      h('div', { class: 'row gap wrap' },
        stat('LP value + fees', usd(r.lpTotal), 'cyan'), stat('Profit / loss', `${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl))} (${pct(pnl / capital * 100, 1)})`, cls(pnl)),
        stat('vs 50/50 HODL', `${r.netVsHodl >= 0 ? '+' : '-'}${usd(Math.abs(r.netVsHodl))}`, cls(r.netVsHodl))),
      h('hr'),
      h('div', { class: 'kv' },
        h('span', {}, 'Position value (no fees)'), h('b', {}, usd(r.lpValue)),
        h('span', {}, 'Fees earned'), h('b', { class: 'up' }, usd(r.fees)),
        h('span', {}, 'Impermanent loss'), h('b', { class: cls(r.il) }, pct(r.il * 100)),
        h('span', {}, '50/50 HODL value'), h('b', {}, usd(r.hodl)),
        h('span', {}, 'All-volatile HODL value'), h('b', {}, usd(r.hodlAllEth)),
        h('span', {}, 'Final mix'), h('b', {}, `${(share * 100).toFixed(0)}% volatile / ${(100 - share * 100).toFixed(0)}% USD`),
        !pos.inRange(r.endPrice) ? [h('span', {}, 'Range'), h('b', { class: 'down' }, 'Out of range — no fees')] : null));
    const moves = []; for (let m = -60; m <= 150; m += 5) moves.push(m);
    const sims = moves.map((m) => ({ m, r: simulate(pos, apr, sigma(), days, m / 100) }));
    const chart = h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Value by price move'),
      h('div', { html: lineChart([
        { name: 'LP + fees', color: '#00e5f2', pts: sims.map((s) => ({ x: s.m, y: s.r.lpTotal })) },
        { name: 'LP, no fees', color: '#8c5cf5', pts: sims.map((s) => ({ x: s.m, y: s.r.lpValue })) },
        { name: '50/50 HODL', color: '#8a93a6', pts: sims.map((s) => ({ x: s.m, y: s.r.hodl })), dash: '5 4' }],
        { fmtX: (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`, fmtY: (v) => usd(v), legend: true, area: false }) }));
    const rows = [-50, -25, -10, 0, 10, 25, 50, 100].map((m) => ({ m, r: simulate(pos, apr, sigma(), days, m / 100) }));
    const scen = h('div', { class: 'card' }, h('div', { class: 'muted small' }, `Scenarios · ${days} days · ${usd(capital)}`),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Price move', 'Price', 'LP + fees', 'P/L', 'IL', 'vs HODL'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map(({ m, r: x }) => h('tr', {},
          h('td', { class: 'num ' + cls(m) }, `${m >= 0 ? '+' : ''}${m}%`), h('td', { class: 'num' }, usd(x.endPrice)), h('td', { class: 'num' }, usd(x.lpTotal)),
          h('td', { class: 'num ' + cls(x.lpTotal - capital) }, (x.lpTotal - capital).toFixed(2)), h('td', { class: 'num ' + cls(x.il) }, pct(x.il * 100)),
          h('td', { class: 'num ' + cls(x.netVsHodl) }, x.netVsHodl.toFixed(2)))))) ),
      h('div', { class: 'muted small' }, 'Simplified model: fee APR held constant, no gas or slippage, and fees are earned only if the price ends inside the range. Not financial advice.'));
    results.replaceChildren(summary, chart, scen);
  }

  function pickPool() {
    const p = pool(); if (!p) return;
    poolInfo.textContent = `TVL ${usd(p.tvl, true)} · 24h volume ${usd(p.volume24h, true)}`;
    loadStats(p).then(() => { if (!aprTouched) { apr = Math.round(paperPoolAPR(p) ?? 0); aprS.input.value = apr; aprS.val.textContent = `${apr}%`; } update(); });
    if (!aprTouched) { apr = Math.round(paperPoolAPR(p) ?? 0); aprS.input.value = apr; aprS.val.textContent = `${apr}%`; }
    update();
  }
  function buildPoolList() {
    poolSel.replaceChildren(...candidates.map((p) => h('option', { value: p.id }, `${p.name} · ${version(p)} · ${p.network}`)));
    if (!candidates.length) poolSel.replaceChildren(h('option', {}, loadingPool ? 'Finding largest ETH/USD pool on Base…' : (poolErr || 'No pools')));
    poolSel.value = poolId;
  }
  async function init() {
    try {
      const { pools } = await topPoolsCached('base');
      const eth = pools.filter((p) => paperInfo(p)?.symbol.toUpperCase().includes('ETH')).sort((a, b) => b.tvl - a.tvl)[0];
      const seen = new Set(), list = [];
      for (const p of [eth, ...S.watched.filter((w) => paperInfo(w)), ...pools.filter((p) => paperInfo(p))]) if (p && !seen.has(p.id)) { seen.add(p.id); list.push(p); }
      candidates = list; poolId = candidates[0]?.id || '';
    } catch (e) { poolErr = e.message; }
    loadingPool = false; buildPoolList(); pickPool();
  }
  buildPoolList(); update();
  let started = false;
  return { show() { if (!started) { started = true; init(); } } };
}
