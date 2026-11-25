// Uniswap Pools tab: tracked pools + browse top pools.
import { h, usd, pct, cls, ago, on } from './util.js';
import { S, isWatched, toggleWatch, addWatchByAddress } from './state.js';
import { NETWORKS, topPoolsCached, version, poolAPR24 } from './api.js';

const uniNet = (n) => (n === 'eth' ? 'ethereum' : n === 'polygon_pos' ? 'polygon' : n);
const netLabel = (id) => NETWORKS.find((n) => n.id === id)?.label || id;

export function mount(root) {
  let mode = 'mine', network = 'eth', ver = 'All', search = '';
  let top = [], topInfo = '', loading = false, topErr = '', addErr = '', adding = false;

  const segMode = h('div', { class: 'seg' });
  const body = h('div', { class: 'stack' });
  root.append(segMode, body);

  // ----- static controls (kept so typing never loses focus) -----
  const addNet = h('select', {}, NETWORKS.map((n) => h('option', { value: n.id }, n.label)));
  const addInput = h('input', { type: 'text', placeholder: 'Paste a Uniswap pool address (0x…)', class: 'grow' });
  const addBtn = h('button', { class: 'btn', onclick: add }, 'Add pool');
  addInput.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const addErrBox = h('div');
  const mineTable = h('div', { class: 'tablewrap' });
  const mineView = h('div', { class: 'stack' }, h('div', { class: 'row gap wrap' }, addNet, addInput, addBtn), addErrBox, mineTable);

  const netSel = h('select', { onchange: () => { network = netSel.value; loadTop(); } }, NETWORKS.map((n) => h('option', { value: n.id }, n.label)));
  netSel.value = network;
  const verSeg = h('div', { class: 'seg' });
  const searchInput = h('input', { type: 'search', placeholder: 'Filter e.g. WETH', class: 'grow', oninput: () => { search = searchInput.value; renderBrowse(); } });
  const browseMsg = h('div'); const browseTable = h('div', { class: 'tablewrap' }); const browseFoot = h('div', { class: 'muted small' });
  const browseView = h('div', { class: 'stack' }, h('div', { class: 'row gap wrap' }, netSel, verSeg, searchInput), browseMsg, browseTable, browseFoot);

  async function add() {
    if (adding || !addInput.value) return;
    adding = true; addBtn.disabled = true; addErr = '';
    try { await addWatchByAddress(addNet.value, addInput.value); addInput.value = ''; } catch (e) { addErr = e.message; }
    adding = false; addBtn.disabled = false; renderMine();
  }

  function table(pools) {
    if (!pools.length) return h('div', { class: 'center pad muted' }, 'Nothing to show.');
    return h('table', {},
      h('thead', {}, h('tr', {}, ['', 'Pool', 'TVL', '24h volume', 'Fee', 'Est. APR', '24h price', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, pools.map((p) => {
        const apr = poolAPR24(p);
        return h('tr', {},
          h('td', {}, h('button', { class: 'star' + (isWatched(p) ? ' on' : ''), title: isWatched(p) ? 'Stop tracking' : 'Track this pool', onclick: () => { toggleWatch(p); } }, isWatched(p) ? '★' : '☆')),
          h('td', {}, h('b', {}, p.name), h('div', { class: 'muted small' }, `${version(p)} · ${netLabel(p.network)}`)),
          h('td', { class: 'num' }, usd(p.tvl, true)), h('td', { class: 'num' }, usd(p.volume24h, true)),
          h('td', { class: 'num' }, p.feePercent != null ? `${+p.feePercent}%` : '—'),
          h('td', { class: 'num' }, apr != null ? `${apr.toFixed(1)}%` : '—'),
          h('td', { class: 'num ' + cls(p.priceChange24h) }, pct(p.priceChange24h)),
          h('td', {}, h('a', { href: `https://app.uniswap.org/explore/pools/${uniNet(p.network)}/${p.address}`, target: '_blank', rel: 'noopener', title: 'Open on Uniswap' }, '↗')));
      })));
  }

  function renderMine() {
    addErrBox.replaceChildren(addErr ? h('div', { class: 'banner' }, addErr) : '');
    mineTable.replaceChildren(S.watched.length ? table(S.watched)
      : h('div', { class: 'center pad muted' }, 'No pools tracked yet. Paste a pool address above, or star pools in “Browse top pools”.'));
    renderSeg();
  }
  function filtered() {
    return top.filter((p) => (ver === 'All' || version(p) === ver) && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  }
  function renderBrowse() {
    verSeg.replaceChildren(...['All', 'V4', 'V3', 'V2'].map((v) => h('button', { class: v === ver ? 'on' : '', onclick: () => { ver = v; renderBrowse(); } }, v)));
    browseMsg.replaceChildren(loading ? h('div', { class: 'muted' }, 'Loading pools…') : '', topErr ? h('div', { class: 'banner' }, topErr) : '');
    browseTable.replaceChildren(table(filtered()));
    browseFoot.textContent = `${topInfo} · APR is an estimate from 24h fees ÷ liquidity, not a guaranteed return · data: GeckoTerminal`;
  }
  async function loadTop() {
    loading = true; topErr = ''; renderBrowse();
    try {
      const r = await topPoolsCached(network);
      top = r.pools; topInfo = `Updated ${ago(r.t)}`;
      if (r.cached) topErr = 'Live pool data is rate limited — showing saved pools.';
    } catch (e) { topErr = e.message; top = []; }
    loading = false; renderBrowse();
  }
  function renderSeg() {
    segMode.replaceChildren(
      h('button', { class: mode === 'mine' ? 'on' : '', onclick: () => { mode = 'mine'; showMode(); } }, `My pools (${S.watched.length})`),
      h('button', { class: mode === 'browse' ? 'on' : '', onclick: () => { mode = 'browse'; showMode(); } }, 'Browse top pools'));
  }
  function showMode() {
    renderSeg(); body.replaceChildren(mode === 'mine' ? mineView : browseView);
    if (mode === 'mine') renderMine(); else { renderBrowse(); if (!top.length && !loading) loadTop(); }
  }
  on('watched', () => { if (mode === 'mine') renderMine(); else { renderBrowse(); renderSeg(); } });
  showMode();
  return { show() { showMode(); } };
}
