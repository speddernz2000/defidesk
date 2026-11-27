// Rebalance preview and position history windows.
import { h, usd, cls, ago, on, off } from './util.js';
import { S, rebalancePaper, refreshPaper } from './state.js';
import { Position, estimateAPR, derive, trackOf, tagOf, DEFAULT_SIGMA } from './math.js';
import { rangeEditor } from './range.js';

export const signed = (v) => `${v >= 0 ? '+' : '-'}${usd(Math.abs(v))}`;
const rangeText = (lo, hi) => (lo == null && hi == null ? 'Full' : `${lo == null ? '0' : usd(lo)} – ${hi == null ? '∞' : usd(hi)}`);
const stat = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
const find = (id) => S.paper.positions.find((p) => p.id === id);

function open(title, body, cleanup) {
  const dlg = h('dialog', { class: 'modal' }, h('div', { class: 'eyebrow' }, title), body);
  dlg.addEventListener('close', () => { cleanup?.(); dlg.remove(); });
  document.body.append(dlg); dlg.showModal();
  return dlg;
}

const CHOICES = [['same', 'Same shape'], ['3', '±3%'], ['8', '±8%'], ['20', '±20%'], ['custom', 'Custom'], ['full', 'Full']];

export function openRebalance(id) {
  const first = find(id); if (!first) return;
  let choice = 'same', lower = -8, upper = 8, refreshing = true, error = '';
  const percents = (p) => {
    if (choice === 'full') return null;
    if (choice === 'custom') return { lo: lower, hi: upper };
    if (choice !== 'same') return { lo: -choice, hi: +choice };
    return p.lower == null || p.upper == null ? null : { lo: (p.lower / p.entryPrice - 1) * 100, hi: (p.upper / p.entryPrice - 1) * 100 };
  };
  const editor = rangeEditor((l, u) => { lower = l; upper = u; choice = 'custom'; draw(); });
  const choices = h('div', { class: 'seg' }), fullNote = h('div', { class: 'muted small' }, 'Full range: never goes out of range.');
  const costIn = h('input', { type: 'number', min: 0, step: 'any', value: 2, class: 'costin', oninput: () => draw() });
  const preview = h('div', { class: 'stack' });
  const confirmBtn = h('button', { class: 'btn', onclick: apply }, 'Rebalance');
  let dlg;
  const body = h('div', { class: 'stack' }, choices, editor.el, fullNote,
    h('label', { class: 'split small' }, h('span', { class: 'muted' }, 'Estimated cost (gas and swap), USD'), costIn), preview,
    h('div', { class: 'row gap end' }, h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'), confirmBtn));

  const range = (p) => { const b = percents(p); return { b, lo: b ? p.currentPrice * (1 + b.lo / 100) : null, hi: b ? p.currentPrice * (1 + b.hi / 100) : null }; };
  function draw() {
    const p = find(id);
    if (!p || p.closedAt) { preview.replaceChildren(h('div', { class: 'banner' }, 'This position is no longer open.')); confirmBtn.disabled = true; return; }
    const { b, lo, hi } = range(p), cost = costIn.value === '' ? NaN : +costIn.value;
    const d = derive(p), t = trackOf(S.paper.positions, p), value = d.totalValue - cost;
    const ok = (!b || (b.lo < 0 && b.hi > 0 && b.lo > -100)) && cost >= 0 && value > 0;
    choices.replaceChildren(...CHOICES.map(([v, label]) => h('button', { type: 'button', class: choice === v ? 'on' : '', onclick: () => { choice = v; draw(); } }, label)));
    editor.el.hidden = !b; fullNote.hidden = !!b;
    if (b) editor.update(b.lo, b.hi, p.currentPrice);
    confirmBtn.disabled = !ok || refreshing; confirmBtn.textContent = refreshing ? 'Updating price…' : 'Rebalance';
    if (!ok) return preview.replaceChildren(h('div', { class: 'down small' }, "Lower must be below 0%, upper above 0%, and the cost less than the position's value."));
    const before = d.pos.amounts(p.currentPrice), after = new Position(value, p.currentPrice, lo, hi).amounts(p.currentPrice);
    const est = estimateAPR(p.poolAPR, lo, hi, p.currentPrice, p.sigma ?? DEFAULT_SIGMA);
    const oldDaily = (d.totalValue * d.est.forecast) / 100 / 365, newDaily = (value * est.forecast) / 100 / 365;
    const row = (l, x, y) => h('tr', {}, h('td', { class: 'muted' }, l), h('td', {}, x), h('td', {}, y));
    preview.replaceChildren(
      h('div', { class: 'tablewrap' }, h('table', { class: 'compare' }, h('tr', {}, h('th'), h('th', {}, 'Now'), h('th', {}, 'After')),
        row('Range', rangeText(p.lower, p.upper), rangeText(lo, hi)), row('Value', usd(d.totalValue), usd(value)),
        row(p.volatileSymbol, before.volatile.toPrecision(4), after.volatile.toPrecision(4)), row('USD', usd(before.stable + p.feesAccrued), usd(after.stable)),
        row('Est. APR', `${d.est.forecast.toFixed(0)}%`, `${est.forecast.toFixed(0)}%`), row('Est. fees per day', usd(oldDaily), usd(newDaily)),
        row('Profit / loss', signed(t.pnl), signed(value - t.originalValue)))),
      h('div', { class: 'muted small' }, newDaily > oldDaily ? `At these estimates the cost is earned back in about ${(cost / (newDaily - oldDaily)).toFixed(1)} days.` : 'Estimated fee income does not go up, so the cost is not earned back.'),
      h('div', { class: 'muted small' }, `Test money only. Price now ${usd(p.currentPrice)}${S.paperUpdated ? `, updated ${ago(S.paperUpdated)}` : ''}. Your original deposit stays ${usd(t.originalValue)}.`),
      error ? h('div', { class: 'down small' }, error) : null);
  }
  function apply() {
    const p = find(id); if (!p) return;
    const { lo, hi } = range(p);
    try { rebalancePaper(id, lo, hi, +costIn.value); dlg.close(); } catch (e) { error = e.message; draw(); }
  }
  const redraw = () => draw();
  dlg = open(`REBALANCE ${tagOf(S.paper.positions, id)} · ${first.poolName}`, body, () => off('paper', redraw));
  on('paper', redraw); draw();
  refreshPaper().finally(() => { refreshing = false; draw(); });
}

export function openHistory(id) {
  const p = find(id); if (!p) return;
  const t = trackOf(S.paper.positions, p), last = t.latest, isOpen = !last.closedAt;
  const event = (name, date, price, leg, value) => h('tr', {}, h('td', {}, h('b', {}, name)), h('td', {}, new Date(date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
    h('td', {}, usd(price)), h('td', {}, rangeText(leg.lower, leg.upper)), h('td', {}, usd(value)), h('td', {}, usd(t.hodlAt(price))), h('td', { class: cls(value - t.originalValue) }, signed(value - t.originalValue)));
  let dlg;
  dlg = open(`HISTORY ${tagOf(S.paper.positions, id)} · ${t.origin.poolName}`, h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap' }, stat('Original deposit', usd(t.originalValue)), stat(isOpen ? 'Value now' : 'Final value', usd(t.value)),
      stat('Profit / loss', `${signed(t.pnl)} (${t.pnlPct.toFixed(2)}%)`, cls(t.pnl)), stat('HODL value', usd(t.hodl)), stat('vs HODL', signed(t.vsHodl), cls(t.vsHodl))),
    h('div', { class: 'muted small' }, `Fees earned ${usd(t.fees)} · rebalance costs ${usd(t.costs)} (both already in the value)`),
    h('div', { class: 'tablewrap' }, h('table', {}, h('tr', {}, ['Event', 'Date', 'Price', 'Range', 'Value', 'HODL value', 'Profit / loss'].map((x) => h('th', {}, x))),
      t.legs.map((leg, i) => event(i ? 'Rebalanced' : 'Opened', leg.openedAt, leg.entryPrice, leg, leg.capital)),
      event(isOpen ? 'Now' : 'Closed', last.closedAt || Date.now(), last.currentPrice, last, t.value))),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Done'))));
}
