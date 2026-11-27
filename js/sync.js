// Keeps wallets, tracked pools and paper trading in step across devices. AI keys never leave the device.
// Does nothing when there is no sync server (e.g. running on localhost).
import { h, load, save, remove, on, emit } from './util.js';
import { S, selectWallet, refreshWallet } from './state.js';
import { DOCS, syncDocs } from './merge.js';

const EMPTY = { bots: () => [], wallets: () => [], watched: () => [], paper: () => ({ startBalance: 10000, cash: 10000, positions: [] }) };
const EVENT = { bots: 'bots', wallets: 'wallet', watched: 'watched', paper: 'paper' };
let busy = false, again = false, timer = null, badge = null;
let base = load('sync:base', {});

const copy = (v) => JSON.parse(JSON.stringify(v));
function set(key, value) {
  S[key] = value; save(key, value);
  if (key === 'wallets') {
    if (!value.some((w) => w.address === S.selWallet)) return selectWallet(value[0]?.address ?? null);
    if (!S.snapshot) refreshWallet();
  }
  emit(EVENT[key]);
}

function status(text, title, onclick) {
  if (!badge) { badge = h('button', { class: 'linkbtn syncbadge' }); document.querySelector('.top-actions').prepend(badge); }
  badge.textContent = text; badge.title = title; badge.onclick = onclick || syncNow;
}

// `manual` redirects: an expired Access session answers with a redirect to the login page.
const api = (path, init) => fetch(path, { redirect: 'manual', cache: 'no-store', ...init });
const signedOut = (r) => r.type === 'opaqueredirect' || r.status === 401 || r.status === 403;

export async function syncNow() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await api('api/data');
      if (r.status === 404) return;                                  // no sync server here
      if (signedOut(r)) return status('Sign in to sync', 'Your sign-in expired', () => location.reload());
      if (!r.ok || !r.headers.get('Content-Type')?.includes('json')) throw new Error('bad response');
      const remote = await r.json();
      // A different person on this browser must not inherit (or upload) the previous person's data.
      const owner = load('sync:user', null);
      if (owner && owner !== remote.user) { base = {}; remove('sync:base'); for (const key of Object.keys(DOCS)) set(key, EMPTY[key]()); }
      save('sync:user', remote.user);
      const result = await syncDocs({
        base, set,
        get: (key) => copy(S[key]),
        push: async (key, value, version) => (await api(`api/data/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, version }) })).status,
      }, remote);
      save('sync:base', base);
      if (result === 'ok') return status('✓ Synced', `Signed in as ${remote.user}`);
    }
    status('Sync pending', 'Another device was saving at the same time. Click to retry.');
  } catch { status('Not synced', 'Offline or the server is unavailable. Click to retry.'); }
  finally {
    busy = false;
    if (again) { again = false; schedule(); }
  }
}

const schedule = () => { clearTimeout(timer); timer = setTimeout(syncNow, 2000); };
const changed = () => Object.entries(DOCS).some(([key, doc]) => !doc.same(S[key], base[key] ?? EMPTY[key]()));

export function startSync() {
  for (const evt of Object.values(EVENT)) on(evt, () => { if (changed()) schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  addEventListener('online', syncNow);
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
  syncNow();
}
