// Paper LP tab: practise liquidity positions with test money.
import { h, usd, pct, cls, ago, on } from './util.js';
import { S, paperOpen, paperClosed, paperPositionsValue, paperTotal, loadStats, paperPoolAPR, paperSigma, enterPaper, closePaper, resetPaper, refreshPaper } from './state.js';
import { NETWORKS, topPoolsCached, fetchPools, paperInfo, version, poolAPR24, uniswapPoolUrl } from './api.js';
import { Position, estimateAPR, derive } from './math.js';
import { rangeBar } from './charts.js';

const PRESETS = [
  { id: 'tight', name: 'Tight', blurb: '±3%', b: [-3, 3] }, { id: 'standard', name: 'Standard', blurb: '±8%', b: [-8, 8] },
  { id: 'wide', name: 'Wide', blurb: '±20%', b: [-20, 20] }, { id: 'custom', name: 'Custom', blurb: 'set bounds' }, { id: 'full', name: 'Full range', blurb: 'never out' },
];
const netLabel = (id) => NETWORKS.find((n) => n.id === id)?.label || id;

export function mount(root) {
  let network = 'base', pools = [], loading = false, err = '', usingCache = false, poolsT = null, retryTimer = null;
  let poolId = '', amount = 1000, preset = 'standard', lowerPct = -8, upperPct = 8, message = null, entering = false, showClosed = false;

  const account = h('div', { class: 'card', style: { '--glow': 'var(--cyan)' } });
  const netSel = h('select', { onchange: () => { network = netSel.value; loadPools(); } }, NETWORKS.map((n) => h('option', { value: n.id }, n.label)));
  netSel.value = network;
  const poolSel = h('select', { class: 'grow', onchange: () => { poolId = poolSel.value; pickPool(); } });
  const poolMsg = h('div'); const poolStats = h('div', { class: 'row gap wrap' }); const poolLink = h('div');
  const amtIn = h('input', { type: 'number', min: 0, step: 'any', value: amount, class: 'grow', oninput: () => { amount = +amtIn.value || 0; refreshEntry(false); } });
  const quick = [25, 50, 100].map((p) => h('button', { class: 'btn ghost', onclick: () => { amount = Math.floor(S.paper.cash * p) / 100; amtIn.value = amount; refreshEntry(false); } }, p === 100 ? 'MAX' : `${p}%`));
  const presetBox = h('div', { class: 'presets' }); const customBox = h('div', { class: 'row gap' });
  const barBox = h('div'); const summaryBox = h('div'); const enterBtn = h('button', { class: 'btn big', onclick: enter }, 'Enter paper position');
  const hint = h('div', { class: 'muted small' }); const msgBox = h('div');
  const entry = h('div', { class: 'card stack', style: { '--glow': 'var(--cyan)' } },
    h('div', { class: 'eyebrow' }, 'NEW PAPER POSITION'),
    h('div', { class: 'row gap' }, netSel, poolSel), poolMsg, poolStats, poolLink,
    h('div', { class: 'field' }, h('div', { class: 'split small' }, h('span', { class: 'lbl' }, 'Deposit (test USD)'), h('span', { class: 'lbl', id: 'avail' })),
      h('div', { class: 'row gap' }, amtIn, ...quick)),
    h('div', { class: 'field' }, h('div', { class: 'lbl small' }, 'Position range'), presetBox, barBox, customBox), summaryBox, enterBtn, hint, msgBox);
  const positions = h('div', { class: 'stack' });
  root.append(account, h('div', { class: 'two paper' }, entry, positions),
    h('div', { class: 'muted small' }, 'Paper trading uses test money only — nothing here touches a real wallet or pool. Prices and pool APR are live; fees are simulated from the pool’s recent volume ÷ liquidity, ignore gas and slippage, and are not a promise of real returns.'));

  // ----- helpers -----
  const pool = () => pools.find((p) => p.id === poolId) || pools[0];
  const boundsFor = (id) => (id === 'full' ? null : id === 'custom' ? { lo: lowerPct, hi: upperPct } : { lo: PRESETS.find((p) => p.id === id).b[0], hi: PRESETS.find((p) => p.id === id).b[1] });
  function estimateFor(b) {
    const p = pool(), info = p && paperInfo(p), base = p && paperPoolAPR(p); if (!info || base == null) return null;
    return estimateAPR(base, b ? info.price * (1 + b.lo / 100) : null, b ? info.price * (1 + b.hi / 100) : null, info.price, paperSigma(p));
  }

  async function loadPools() {
    loading = true; err = ''; clearTimeout(retryTimer); refreshEntry(true);
    try {
      const r = await topPoolsCached(network);
      pools = r.pools.filter((p) => paperInfo(p) && p.tvl > 50000); usingCache = r.cached; poolsT = r.t;
      if (r.cached) err = 'Live pool data is rate limited — showing saved pools. Prices refresh when you enter.';
    } catch (e) { pools = []; err = 'Pool data is rate limited right now — retrying automatically.'; usingCache = true; }
    loading = false;
    if (usingCache) retryTimer = setTimeout(loadPools, 25000);
    if (!pools.some((p) => p.id === poolId)) poolId = pools[0]?.id || '';
    pickPool();
  }
  function pickPool() { refreshEntry(true); const p = pool(); if (p) loadStats(p); }

  // ----- entry card -----
  function refreshEntry(rebuildPools) {
    const p = pool(), info = p && paperInfo(p);
    if (rebuildPools) {
      poolSel.replaceChildren(...(pools.length ? pools.map((x) => h('option', { value: x.id }, `${x.name} · ${version(x)}`)) : [h('option', {}, loading ? 'Loading pools…' : 'No pools')]));
      poolSel.value = p?.id || '';
    }
    poolMsg.replaceChildren(
      !pools.length && !loading ? h('div', { class: 'row gap' }, h('span', { class: 'banner grow' }, err || 'No supported pools found.'), h('button', { class: 'btn ghost', onclick: loadPools }, 'Retry now')) : '',
      usingCache && pools.length ? h('div', { class: 'muted small' }, `Showing saved pools${poolsT ? ` from ${ago(poolsT)}` : ''} — live data is rate limited. Your entry price is refreshed when you enter. `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); loadPools(); } }, 'Retry')) : '');
    const avail = entry.querySelector('#avail'); if (avail) avail.textContent = `Available ${usd(S.paper.cash)}`;
    poolStats.replaceChildren(...(p && info ? [
      ['%s price'.replace('%s', info.symbol), usd(info.price)], ['TVL', usd(p.tvl, true)], ['24h volume', usd(p.volume24h, true)],
      [S.stats[p.id] ? 'Pool APR (7d avg)' : 'Pool APR (24h)', paperPoolAPR(p) != null ? `${paperPoolAPR(p).toFixed(0)}%` : '—']].map(([l, v]) => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', {}, v))) : []));
    poolLink.replaceChildren(p ? realLink(p.network, p.address, 'Open this pool on Uniswap ↗', 'Uniswap’s page for this pool has an “Add liquidity” button to enter with real funds from your own wallet.') : '');
    presetBox.replaceChildren(...PRESETS.map((r) => {
      const e = estimateFor(boundsFor(r.id));
      return h('button', { class: 'preset' + (preset === r.id ? ' on' : ''), onclick: () => { preset = r.id; refreshEntry(false); } },
        h('b', {}, r.name), h('span', {}, r.blurb + (e ? ` · ~${e.forecast.toFixed(0)}% APR` : '')));
    }));
    const b = boundsFor(preset);
    if (p && info) barBox.innerHTML = rangeBar({ lower: b ? info.price * (1 + b.lo / 100) : null, upper: b ? info.price * (1 + b.hi / 100) : null, current: info.price });
    customBox.replaceChildren(...(preset === 'custom' && info ? [
      bound('Lower bound', () => lowerPct, (v) => { lowerPct = v; }, info.price, -95, -0.5), bound('Upper bound', () => upperPct, (v) => { upperPct = v; }, info.price, 0.5, 500)] : []));
    summaryBox.replaceChildren(p && info ? summary(p, info, b) : '');
    enterBtn.disabled = !p || !(amount > 0) || entering; enterBtn.textContent = entering ? 'Entering…' : 'Enter paper position';
    hint.textContent = !p ? 'Waiting for pool data — choose a network above or press Retry.' : !(amount > 0) ? 'Enter an amount above zero.' : '';
    msgBox.replaceChildren(message ? h('div', { class: message.err ? 'down' : 'up' }, message.text) : '');
  }
  function bound(label, get, set, price, min, max) {
    const inp = h('input', { type: 'number', step: 0.5, value: get(), class: 'center' });
    const apply = (v) => { set(Math.min(Math.max(v, min), max)); refreshEntry(false); };
    inp.addEventListener('change', () => apply(+inp.value));
    return h('div', { class: 'boundbox grow' }, h('div', { class: 'split small' }, h('span', { class: 'lbl' }, label), h('span', { class: 'mono' }, usd(price * (1 + get() / 100)))),
      h('div', { class: 'row gap' }, h('button', { class: 'btn ghost', onclick: () => apply(get() - 1) }, '−'), inp, h('span', {}, '%'), h('button', { class: 'btn ghost', onclick: () => apply(get() + 1) }, '+')));
  }
  function summary(p, info, b) {
    const lo = b ? info.price * (1 + b.lo / 100) : null, hi = b ? info.price * (1 + b.hi / 100) : null;
    const pos = new Position(Math.max(amount, 0.01), info.price, lo, hi), a = pos.amounts(info.price), e = estimateFor(b);
    const row = (l, v) => [h('span', {}, l), h('b', {}, v)];
    const st = S.stats[p.id];
    return h('div', { class: 'sumbox' },
      h('div', { class: 'split' }, h('span', { class: 'muted' }, 'Est. APR for this range'), h('span', { class: 'bigapr' }, e ? `${e.forecast.toFixed(0)}%` : '—')),
      e ? h('div', { class: 'kv' }, ...row('While price is in range', `${e.whileInRange.toFixed(0)}% APR`), ...row('Expected time in range (7 days)', `${(e.timeInRange * 100).toFixed(0)}%`), ...row('Est. fees per day', usd(amount * e.forecast / 100 / 365))) : null,
      h('hr'),
      h('div', { class: 'kv' }, ...row('Range width', b ? `${(b.hi - b.lo).toFixed(1)}%` : 'Full'), ...row("You'd deposit", `${a.volatile.toPrecision(4)} ${info.symbol} + ${usd(a.stable)}`)),
      b && b.hi - b.lo < 6 ? h('div', { class: 'warn small' }, "Very tight range: high fees while in range, but price will often leave it — you'd need frequent rebalancing (gas not included).") : null,
      h('div', { class: 'muted small' }, st
        ? `How it's estimated: pool fees ÷ liquidity using ${st.days}-day average volume (${usd(st.avgVolume7d, true)}/day), scaled by how tight your range is and discounted by how often a ${(st.sigmaDaily * 100).toFixed(1)}%/day-volatile price would leave it. An estimate — real APR depends on where other LPs sit and future volume.`
        : "How it's estimated: pool fees ÷ liquidity from the last 24h of volume (7-day history still loading), scaled by range tightness. An estimate only."));
  }
  async function enter() {
    const cached = pool(); if (!cached || entering) return;
    entering = true; message = null; refreshEntry(false);
    let fresh = null; try { fresh = (await fetchPools(cached.network, [cached.address]))[0]; if (fresh && !paperInfo(fresh)) fresh = null; } catch { /* use saved price */ }
    const p = fresh || cached, info = paperInfo(p), b = boundsFor(preset);
    try {
      if (b && !(b.lo < 0 && b.hi > 0 && b.lo > -100)) throw new Error('Lower bound must be below the price (negative %) and upper bound above it.');
      enterPaper(p, amount, b ? info.price * (1 + b.lo / 100) : null, b ? info.price * (1 + b.hi / 100) : null);
      message = { text: `Entered ${p.name} with ${usd(amount)} of test money at ${usd(info.price)}.` + (fresh ? '' : ' (Used the saved price — live data was rate limited.)') };
    } catch (e) { message = { err: true, text: e.message }; }
    entering = false; refreshEntry(false);
  }

  // Link to the real pool on Uniswap (real money, user's own wallet). Paper positions are never sent anywhere.
  function realLink(network, address, label, note) {
    const a = h('a', { class: 'btn ghost uni', href: uniswapPoolUrl(network, address), target: '_blank', rel: 'noopener', title: 'Opens Uniswap — uses real funds from your own wallet' }, label);
    return note ? h('div', { class: 'row gap wrap' }, a, h('span', { class: 'muted small grow' }, note)) : a;
  }

  // ----- account + positions -----
  function renderAccount() {
    const pnl = paperTotal() - S.paper.startBalance, st = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
    account.replaceChildren(h('div', { class: 'split wrap' }, h('div', { class: 'row gap wrap' },
      st('Test cash', usd(S.paper.cash), 'cyan'), st('In positions', usd(paperPositionsValue())), st('Total value', usd(paperTotal())),
      st('Profit / loss', `${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl))} (${pct(pnl / S.paper.startBalance * 100, 1)})`, cls(pnl))),
      h('div', { class: 'col right' }, h('button', { class: 'linkbtn down', onclick: () => { if (confirm('Reset demo account? This deletes all paper positions and gives you fresh $10,000 test money.')) resetPaper(); } }, 'Reset demo account'),
        h('span', { class: 'muted small' }, S.paperUpdated ? `prices ${ago(S.paperUpdated)}` : ''))));
  }
  function positionCard(p) {
    const d = derive(p);
    const st = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
    return h('div', { class: 'subcard' },
      h('div', { class: 'split wrap' }, h('div', { class: 'row gap wrap' }, h('b', { class: 'big-name' }, p.poolName), h('span', { class: 'muted small' }, `${p.version} · ${netLabel(p.network)}`),
        h('span', { class: 'badge ' + (d.inRange ? 'up' : 'down') }, d.inRange ? 'IN RANGE' : 'OUT OF RANGE')),
        h('div', { class: 'row gap' }, h('span', { class: 'muted small' }, `opened ${ago(p.openedAt)}`), realLink(p.network, p.address, 'Enter for real ↗'), h('button', { class: 'btn danger', onclick: () => closePaper(p.id) }, 'Close'))),
      h('div', { html: rangeBar({ lower: p.lower, upper: p.upper, current: p.currentPrice, entry: p.entryPrice }) }),
      h('div', { class: 'row gap wrap' }, st('Value now', usd(d.totalValue)), st('Profit / loss', `${d.pnl >= 0 ? '+' : '-'}${usd(Math.abs(d.pnl))} (${pct(d.pnl / p.capital * 100)})`, cls(d.pnl)),
        st('Fees earned*', usd(p.feesAccrued), 'up'), st('Impermanent loss', pct(d.il * 100), cls(d.il)), st('Est. APR (forecast)', `${d.est.forecast.toFixed(0)}%`)),
      h('div', { class: 'muted small' }, `${p.volatileSymbol} entered at ${usd(p.entryPrice)} · now ${usd(p.currentPrice)} · range ${p.lower == null ? '0' : usd(p.lower)} – ${p.upper == null ? '∞' : usd(p.upper)} · invested ${usd(p.capital)} · *simulated`));
  }
  function renderPositions() {
    const open = paperOpen(), closed = paperClosed();
    positions.replaceChildren(
      h('div', { class: 'card', style: { '--glow': 'var(--up)' } }, h('div', { class: 'eyebrow', style: { color: 'var(--up)' } }, `OPEN POSITIONS (${open.length})`),
        open.length ? h('div', { class: 'stack' }, open.map(positionCard)) : h('div', { class: 'center pad muted' }, 'No paper positions yet — pick a pool and a range, then enter with test money.')),
      closed.length ? h('div', { class: 'card', style: { '--glow': '#777' } },
        h('button', { class: 'linkbtn', onclick: () => { showClosed = !showClosed; renderPositions(); } }, `${showClosed ? '▾' : '▸'} CLOSED (${closed.length}) · realised ${usd(closed.reduce((t, p) => t + (p.closeValue - p.capital), 0))}`),
        showClosed ? h('div', { class: 'stack' }, closed.map((p) => h('div', { class: 'split small' }, h('span', {}, h('b', {}, `${p.poolName} · ${p.version}`), ` ${ago(p.closedAt)}`),
          h('span', { class: 'mono' }, `${usd(p.capital)} → ${usd(p.closeValue)} `, h('b', { class: cls(p.closeValue - p.capital) }, (p.closeValue - p.capital).toFixed(2)))))) : null) : null);
  }
  const renderAll = () => { renderAccount(); renderPositions(); refreshEntry(false); };
  on('paper', renderAll); on('stats', () => refreshEntry(false));
  renderAll();
  return { show() { renderAll(); if (!pools.length && !loading) loadPools(); refreshPaper(); } };
}
