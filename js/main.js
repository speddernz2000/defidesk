// App shell: tabs, refresh timers, AI panel, service worker.
import { $, h, load, save } from './util.js';
import { S, refreshCoins, loadHistory, refreshWallet, refreshWatched, refreshPaper } from './state.js';
import * as tokens from './tokens.js';
import * as pools from './pools.js';
import * as calc from './calc.js';
import * as wallet from './wallet.js';
import * as paper from './paper.js';
import * as ai from './ai.js';

const TABS = [['tokens', 'Tokens', tokens], ['pools', 'Uniswap Pools', pools], ['calc', 'Calculator', calc], ['wallet', 'Wallet', wallet], ['paper', 'Paper LP', paper]];
const main = $('#main'), nav = $('#tabs');
const views = {};
let current = load('tab', 'tokens');
if (!TABS.some((t) => t[0] === current)) current = 'tokens';

for (const [id, label, mod] of TABS) {
  const sec = h('section', { id: `view-${id}`, class: 'view', hidden: true });
  main.append(sec);
  views[id] = mod.mount(sec);
  nav.append(h('button', { class: 'tab', 'data-tab': id, onclick: () => show(id) }, label));
}
function show(id) {
  current = id; save('tab', id);
  TABS.forEach(([t]) => { $(`#view-${t}`).hidden = t !== id; });
  nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  views[id].show?.();
  window.scrollTo(0, 0);
}

const panel = ai.mount($('#ai'));
$('#ai-btn').addEventListener('click', () => { panel.toggle(); $('#ai-btn').classList.toggle('on', panel.isOpen()); });
addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); panel.toggle(); $('#ai-btn').classList.toggle('on', panel.isOpen()); } });

async function refreshAll() { await refreshCoins(); loadHistory(true); refreshWatched(); refreshWallet(); refreshPaper(); }
$('#refresh').addEventListener('click', refreshAll);

let tick = 0;
setInterval(() => {                                    // free APIs are rate limited: prices every minute, the rest every 3
  if (document.hidden) return;
  tick++; refreshCoins(); loadHistory();
  if (tick % 3 === 0) { refreshWatched(); refreshWallet(); refreshPaper(); }
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshCoins(); refreshPaper(); } });   // catch up (and accrue paper fees) on return

show(current);
refreshCoins(); refreshWatched(); refreshPaper();
if (S.selWallet) refreshWallet();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
