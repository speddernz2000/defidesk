// Shared app state + the actions that load/modify it. Everything personal lives in this browser's localStorage.
import { load, save, sleep, emit } from './util.js';
import * as api from './api.js';
import { derive, DEFAULT_SIGMA } from './math.js';

const cachedCoins = load('cache:coins', null);          // last good prices, so something shows even when the data source is limited
export const S = {
  coins: cachedCoins?.coins || [], coinsUpdated: cachedCoins?.t || null, coinsSource: cachedCoins?.source || 'CoinGecko', coinsError: null,
  tf: load('tf', '7D'), history: load('cache:hist', {}), historyErr: null, historyLoading: false,
  wallets: load('wallets', []),                          // [{address,label}]
  selWallet: load('selWallet', null), snapshot: null, walletErr: null, walletLoading: false,
  watched: load('watched', []),                          // pool objects
  stats: load('cache:stats', {}),                        // poolId -> stats
  paper: load('paper', { startBalance: 10000, cash: 10000, positions: [] }),
  paperErr: null, paperUpdated: null,
};
export const TF = { '24H': 1, '7D': 7, '30D': 30, '90D': 90, '1Y': 365, '5Y': 1825 };
export const btcPrice = () => S.coins.find((c) => c.id === 'bitcoin')?.price ?? null;
export const ethPrice = () => S.coins.find((c) => c.id === 'ethereum')?.price ?? null;

// ---------- prices ----------
export async function refreshCoins() {
  try {
    const r = await api.fetchCoins();
    S.coins = r.coins; S.coinsSource = r.source; S.coinsUpdated = Date.now(); S.coinsError = null;
    save('cache:coins', { t: S.coinsUpdated, source: r.source, coins: r.coins });
  } catch (e) { S.coinsError = S.coins.length ? `${e.message} Showing the last saved prices.` : e.message; }
  emit('coins');
}
const histT = {};
export async function loadHistory(force = false) {
  const days = TF[S.tf]; S.historyLoading = true; emit('history');
  for (const id of ['bitcoin', 'ethereum']) {
    const key = `${id}:${days}`;
    if (!force && S.history[key] && Date.now() - (histT[key] || 0) < 300000) continue;
    try { S.history[key] = await api.fetchHistory(id, days); histT[key] = Date.now(); S.historyErr = null; save('cache:hist', S.history); }
    catch (e) { S.historyErr = e.message; }
    emit('history'); await sleep(1200);
  }
  S.historyLoading = false; emit('history');
}
export function setTF(tf) { S.tf = tf; save('tf', tf); loadHistory(); emit('history'); }

// ---------- watched pools ----------
export const isWatched = (p) => S.watched.some((w) => w.id === p.id);
export function toggleWatch(p) {
  S.watched = isWatched(p) ? S.watched.filter((w) => w.id !== p.id) : [...S.watched, p];
  save('watched', S.watched); emit('watched');
}
export async function addWatchByAddress(network, address) {
  const a = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40,}$/.test(a)) throw new Error('Enter a valid pool address (0x…).');
  const [p] = await api.fetchPools(network, [a]);
  if (!p) throw new Error('Pool not found on that network.');
  if (!api.isUniswap(p)) throw new Error(`That pool isn't a Uniswap pool (${p.dex}).`);
  if (!isWatched(p)) toggleWatch(p);
}
export async function refreshWatched() {
  if (!S.watched.length) return;
  try {
    const by = {}; S.watched.forEach((p) => (by[p.network] ||= []).push(p.address));
    const fresh = [];
    for (const [net, addrs] of Object.entries(by)) fresh.push(...(await api.fetchPools(net, addrs)));
    const order = S.watched.map((p) => p.id);
    S.watched = fresh.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    save('watched', S.watched);
  } catch { /* keep cached */ }
  emit('watched');
}

// ---------- Aave wallets (read-only, public addresses) ----------
export function addWallet(address, label = '') {
  const a = address.trim();
  if (!api.isValidAddress(a)) throw new Error('Enter a valid wallet address (0x followed by 40 hex characters).');
  const i = S.wallets.findIndex((w) => w.address.toLowerCase() === a.toLowerCase());
  if (i >= 0) { if (label) S.wallets[i].label = label; } else S.wallets.push({ address: a, label: label.trim() });
  save('wallets', S.wallets); selectWallet(a);
}
export function renameWallet(address, label) { const w = S.wallets.find((x) => x.address === address); if (w) { w.label = label; save('wallets', S.wallets); emit('wallet'); } }
export function removeWallet(address) {
  S.wallets = S.wallets.filter((w) => w.address !== address); save('wallets', S.wallets);
  selectWallet(S.wallets[0]?.address ?? null);
}
export function selectWallet(address) { S.selWallet = address; save('selWallet', address); S.snapshot = null; emit('wallet'); if (address) refreshWallet(); }
export async function refreshWallet() {
  const a = S.selWallet; if (!a) return;
  S.walletLoading = true; emit('wallet');
  try { const snap = await api.fetchAave(a); if (a === S.selWallet) { S.snapshot = snap; S.walletErr = null; } }
  catch (e) { S.walletErr = e.message; }
  S.walletLoading = false; emit('wallet');
}

// ---------- paper trading ----------
const persistPaper = () => save('paper', S.paper);
export const paperOpen = () => S.paper.positions.filter((p) => !p.closedAt).sort((a, b) => b.openedAt - a.openedAt);
export const paperClosed = () => S.paper.positions.filter((p) => p.closedAt).sort((a, b) => b.closedAt - a.closedAt);
export const paperPositionsValue = () => paperOpen().reduce((t, p) => t + derive(p).totalValue, 0);
export const paperTotal = () => S.paper.cash + paperPositionsValue();

export async function loadStats(pool) {
  const s = S.stats[pool.id];
  if (s && Date.now() - s.fetched < 6 * 3600 * 1000) return s;
  try { const st = await api.fetchPoolStats(pool); if (st) { S.stats[pool.id] = st; save('cache:stats', S.stats); emit('stats'); } } catch { /* optional */ }
  return S.stats[pool.id];
}
/** Pool APR using the 7-day average volume when we have it (steadier), else the single-day figure. */
export function paperPoolAPR(p) {
  const st = S.stats[p.id];
  if (st && p.feePercent != null && p.tvl > 0) return (st.avgVolume7d * (p.feePercent / 100)) / p.tvl * 365 * 100;
  return api.poolAPR24(p);
}
export const paperSigma = (p) => S.stats[p.id]?.sigmaDaily ?? DEFAULT_SIGMA;

export function enterPaper(pool, capital, lower, upper) {
  const info = api.paperInfo(pool);
  if (!info) throw new Error("This pool isn't supported for paper trading.");
  if (!(capital > 0)) throw new Error('Enter an amount greater than zero.');
  if (capital > S.paper.cash + 0.005) throw new Error(`Not enough test money — you have $${S.paper.cash.toFixed(2)} available.`);
  const now = Date.now();
  S.paper.cash -= capital;
  S.paper.positions.push({
    id: crypto.randomUUID(), poolKey: pool.id, network: pool.network, address: pool.address, poolName: pool.name, version: api.version(pool),
    volatileSymbol: info.symbol, capital, entryPrice: info.price, lower, upper, openedAt: now, currentPrice: info.price,
    poolAPR: paperPoolAPR(pool) ?? 0, sigma: paperSigma(pool), feesAccrued: 0, lastAccrual: now, closedAt: null,
  });
  persistPaper(); emit('paper');
}
function accrue(p, now) {
  const d = derive(p), dt = Math.max(0, (now - p.lastAccrual) / 1000);
  if (d.inRange) p.feesAccrued += (p.capital * d.est.whileInRange / 100 * dt) / (365 * 86400);
  p.lastAccrual = now;
}
export function closePaper(id) {
  const p = S.paper.positions.find((x) => x.id === id); if (!p || p.closedAt) return;
  const now = Date.now(); accrue(p, now);
  const v = derive(p).positionValue + p.feesAccrued;
  p.closedAt = now; p.closePrice = p.currentPrice; p.closeValue = v; S.paper.cash += v;
  persistPaper(); emit('paper');
}
export function resetPaper() { S.paper = { startBalance: 10000, cash: 10000, positions: [] }; persistPaper(); emit('paper'); }

/** Refresh live prices for open positions and accrue simulated fees. */
export async function refreshPaper() {
  const open = paperOpen(); if (!open.length) return;
  try {
    const by = {}; open.forEach((p) => (by[p.network] ||= new Set()).add(p.address.toLowerCase()));
    for (const [net, set] of Object.entries(by)) {
      const addrs = [...set];
      for (let i = 0; i < addrs.length; i += 30) {
        for (const pool of await api.fetchPools(net, addrs.slice(i, i + 30))) {
          const info = api.paperInfo(pool); if (!info) continue;
          await loadStats(pool);
          for (const p of open) {
            if (p.network !== net || p.address.toLowerCase() !== pool.address.toLowerCase()) continue;
            accrue(p, Date.now());                         // accrue on the old price state, then move to the new price
            p.currentPrice = info.price; p.poolAPR = paperPoolAPR(pool) ?? p.poolAPR; p.sigma = paperSigma(pool);
          }
        }
      }
    }
    S.paperUpdated = Date.now(); S.paperErr = null; persistPaper();
  } catch (e) { S.paperErr = e.message; }
  emit('paper');
}
