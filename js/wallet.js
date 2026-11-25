// Wallet tab: read-only Aave V3 positions for public addresses.
import { h, usd, pct, cls, ago, on, short, load, save } from './util.js';
import { S, addWallet, removeWallet, renameWallet, selectWallet, refreshWallet, btcPrice } from './state.js';
import { chainName } from './api.js';
import { btcLiquidation, aaveTotals } from './math.js';

export function mount(root) {
  let err = '', warnHF = load('warnHF', 1.5);
  const nameIn = h('input', { type: 'text', placeholder: 'Name (optional)', style: { width: '9rem' } });
  const addrIn = h('input', { type: 'text', placeholder: 'Paste a public wallet address (0x…)', class: 'grow' });
  const addBtn = h('button', { class: 'btn', onclick: add }, 'Save & track');
  addrIn.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const errBox = h('div'); const savedBar = h('div', { class: 'row gap wrap' }); const content = h('div', { class: 'stack' });
  root.append(h('div', { class: 'stack' }, h('div', { class: 'row gap wrap' }, nameIn, addrIn, addBtn), errBox, savedBar, content));

  function add() {
    try { addWallet(addrIn.value, nameIn.value); addrIn.value = ''; nameIn.value = ''; err = ''; } catch (e) { err = e.message; }
    render();
  }

  const hfColor = (hf) => (hf == null || hf >= 2 ? 'up' : hf >= 1.5 ? 'warn' : 'down');
  const dropColor = (d) => (d > -15 ? 'down' : d > -30 ? 'warn' : 'up');
  const money = (v) => usd(v, v >= 100000);

  function liqCells(snap, a, target, kind) {
    const bp = btcPrice(); const l = bp ? btcLiquidation(snap, a.chainId, bp, target) : null;
    if (!l) return [h('td', { class: 'num muted' }, '—'), h('td', { class: 'num muted' }, '—')];
    if (l.price == null) return [h('td', { class: 'num up' }, 'Not at risk'), h('td', { class: 'num muted' }, '—')];
    if (l.dropPct === 0) return [h('td', { class: 'num down' }, 'Reached'), h('td', { class: 'num down' }, 'now')];
    const c = kind === 'warn' ? 'warn' : dropColor(l.dropPct);
    return [h('td', { class: `num ${c}` }, h('b', {}, usd(l.price))), h('td', { class: `num ${c}` }, `${l.dropPct.toFixed(1)}%`)];
  }

  function posTable(title, rows, supply) {
    if (!rows.length) return null;
    return h('div', { class: 'card', style: { '--glow': supply ? 'var(--up)' : 'var(--down)' } },
      h('div', { class: 'eyebrow', style: { color: supply ? 'var(--up)' : 'var(--down)' } }, title),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Asset', 'Network', 'Amount', 'Value', 'APY', supply ? 'Collateral' : ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, h('b', {}, r.symbol)), h('td', { class: 'muted' }, chainName(r.chainId)),
          h('td', { class: 'num' }, r.amount >= 1000 ? r.amount.toFixed(0) : r.amount.toPrecision(4)), h('td', { class: 'num' }, usd(r.usd)),
          h('td', { class: 'num ' + (supply ? 'up' : 'down') }, `${r.apy.toFixed(2)}%`), h('td', {}, supply ? (r.isCollateral ? '✓' : '○') : '')))))));
  }

  function render() {
    errBox.replaceChildren(err ? h('div', { class: 'banner' }, err) : '', S.walletErr ? h('div', { class: 'banner' }, S.walletErr) : '');
    savedBar.replaceChildren();
    if (S.wallets.length) {
      const sel = h('select', { onchange: () => selectWallet(sel.value) }, S.wallets.map((w) => h('option', { value: w.address }, `${w.label || short(w.address)} · ${short(w.address)}`)));
      sel.value = S.selWallet || S.wallets[0].address;
      savedBar.append(h('span', { class: 'eyebrow' }, 'SAVED'), sel,
        h('button', { class: 'btn ghost', title: 'Rename', onclick: () => { const w = S.wallets.find((x) => x.address === sel.value); const n = prompt('Name for this wallet', w?.label || ''); if (n != null) renameWallet(sel.value, n.trim()); } }, '✎'),
        h('button', { class: 'btn ghost', title: 'Remove from saved list', onclick: () => { if (confirm('Remove this wallet from the saved list?')) removeWallet(sel.value); } }, '🗑'),
        S.walletLoading ? h('span', { class: 'muted small' }, 'loading…') : null);
    }
    const snap = S.snapshot;
    if (!S.wallets.length) { content.replaceChildren(h('div', { class: 'center pad muted' }, 'Track a wallet: paste a public address to see its Aave V3 positions on Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche. Read-only — never enter a seed phrase or private key.')); return; }
    if (!snap) { content.replaceChildren(h('div', { class: 'center pad muted' }, S.walletLoading ? 'Reading Aave positions…' : '')); return; }
    const t = aaveTotals(snap);
    const stat = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
    const warnIn = h('input', { type: 'number', min: 1.05, max: 3, step: 0.05, value: warnHF, style: { width: '5rem' } });
    warnIn.addEventListener('change', () => { warnHF = Math.min(Math.max(+warnIn.value || 1.5, 1.05), 3); save('warnHF', warnHF); render(); });
    content.replaceChildren(
      h('div', { class: 'card', style: { '--glow': 'var(--cyan)' } }, h('div', { class: 'row gap wrap' },
        stat('Net worth in Aave', money(t.net), 'cyan'), stat('Supplied', money(t.supplied), 'up'), stat('Borrowed', money(t.borrowed), 'down'),
        stat('Net APY', t.netAPY == null ? '—' : `${t.netAPY.toFixed(2)}%`, cls(t.netAPY)),
        stat('Lowest health factor', t.lowestHF == null ? 'No debt' : t.lowestHF.toFixed(2), hfColor(t.lowestHF)))),
      snap.accounts.length ? h('div', { class: 'card' },
        h('div', { class: 'split' }, h('div', { class: 'eyebrow' }, 'BY NETWORK'), h('label', { class: 'small' }, 'Warn at health factor ', warnIn)),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Network', 'Collateral', 'Debt', 'Can still borrow', 'LTV limit', 'Liq. threshold', 'Health factor', 'BTC warning price', 'Drop to warning', 'BTC liquidation price', 'Drop to liquidation'].map((x) => h('th', {}, x)))),
          h('tbody', {}, snap.accounts.map((a) => h('tr', {},
            h('td', {}, h('b', {}, chainName(a.chainId))), h('td', { class: 'num' }, money(a.collateralUSD)), h('td', { class: 'num' }, money(a.debtUSD)),
            h('td', { class: 'num' }, money(a.availableBorrowsUSD)), h('td', { class: 'num' }, `${a.ltv.toFixed(1)}%`), h('td', { class: 'num' }, `${a.liqThreshold.toFixed(1)}%`),
            h('td', { class: `num ${hfColor(a.healthFactor)}` }, h('b', {}, a.healthFactor == null ? '∞' : a.healthFactor.toFixed(2))),
            ...liqCells(snap, a, warnHF, 'warn'), ...liqCells(snap, a, 1, 'liq')))))),
        h('div', { class: 'muted small' }, 'Health factor below 1.0 means the position can be liquidated; under about 1.5 is risky. BTC prices assume only BTC moves — other collateral and your debt hold their USD value — so a broader market drop would liquidate sooner. An estimate, not a guarantee.')) : null,
      posTable('SUPPLIED', snap.supplies, true), posTable('BORROWED', snap.borrows, false),
      !snap.supplies.length && !snap.borrows.length ? h('div', { class: 'center pad muted' }, 'No Aave V3 positions found for this address on the supported networks.') : null,
      h('div', { class: 'muted small' }, `Updated ${ago(snap.fetched)} · refreshes every 3 min · data: Aave API + on-chain reads · Aave V3 main markets only`));
  }
  on('wallet', render); on('coins', () => S.snapshot && render());
  render();
  return { show() { if (S.selWallet && !S.snapshot && !S.walletLoading) refreshWallet(); render(); } };
}
