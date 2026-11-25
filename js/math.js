// Liquidity-position maths, APR estimate (time-in-range model) and Aave scenario maths.

export class Position {
  constructor(capital, startPrice, lower = null, upper = null) { Object.assign(this, { capital, startPrice, lower, upper }); }
  get full() { return this.lower == null || this.upper == null; }
  get L() {
    const p0 = this.startPrice;
    if (this.full) return this.capital / (2 * Math.sqrt(p0));
    const p = Math.min(Math.max(p0, this.lower), this.upper);
    const x = 1 / Math.sqrt(p) - 1 / Math.sqrt(this.upper), y = Math.sqrt(p) - Math.sqrt(this.lower);
    return this.capital / (x * p0 + y);
  }
  amounts(price) {            // {volatile token amount, stablecoin USD}
    const L = this.L;
    if (this.full) return { volatile: L / Math.sqrt(price), stable: L * Math.sqrt(price) };
    const p = Math.min(Math.max(price, this.lower), this.upper);
    return { volatile: L * (1 / Math.sqrt(p) - 1 / Math.sqrt(this.upper)), stable: L * (Math.sqrt(p) - Math.sqrt(this.lower)) };
  }
  value(price) { const a = this.amounts(price); return a.volatile * price + a.stable; }
  inRange(price) { return this.full || (price >= this.lower && price <= this.upper); }
  get concentration() { return this.full ? 1 : 1 / (1 - Math.sqrt(this.lower / this.upper)); }
}

// ---------- APR estimate ----------
export const DEFAULT_SIGMA = 0.035;          // 3.5% a day when a pool has no price history
const PATHS = 500, STEPS = 168;               // 7 days, hourly
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let SHOCKS = null;
function shocks() {
  if (SHOCKS) return SHOCKS;
  const r = mulberry32(12345); SHOCKS = new Float32Array(PATHS * STEPS);
  for (let i = 0; i < SHOCKS.length; i += 2) {
    const u1 = Math.max(r(), 1e-9), u2 = r(), m = Math.sqrt(-2 * Math.log(u1));
    SHOCKS[i] = m * Math.cos(2 * Math.PI * u2); SHOCKS[i + 1] = m * Math.sin(2 * Math.PI * u2);
  }
  return SHOCKS;
}
/** Expected share of the next 7 days a price starting at `start` spends inside [lower, upper]. */
export function timeInRange(lower, upper, start, sigma) {
  if (lower == null && upper == null) return 1;
  const lo = (lower ?? 0) / start, hi = (upper ?? Infinity) / start;
  const sh = sigma / Math.sqrt(24), drift = -0.5 * sh * sh, S = shocks();
  let inside = 0;
  for (let p = 0; p < PATHS; p++) {
    let x = 1;
    for (let t = 0; t < STEPS; t++) { x *= Math.exp(drift + sh * S[p * STEPS + t]); if (x >= lo && x <= hi) inside++; }
  }
  return inside / (PATHS * STEPS);
}
const conc = (l, u) => (l != null && u != null && u > l && l > 0 ? 1 / (1 - Math.sqrt(l / u)) : 1);
const fRefCache = new Map();
/**
 * Pool APR is the average LP's return. With no tick data we assume the average LP sits ±10%. A tighter range earns more per
 * dollar, but only while price is inside it — so tight ranges are discounted by how often price leaves them.
 */
export function estimateAPR(poolAPR, lower, upper, current, sigma) {
  const key = sigma.toFixed(4);
  if (!fRefCache.has(key)) fRefCache.set(key, Math.max(timeInRange(0.9, 1.1, 1, sigma), 0.05));
  const factor = Math.min(Math.max(conc(lower, upper) / (conc(0.9, 1.1) * fRefCache.get(key)), 0.05), 12);
  const f = timeInRange(lower, upper, current, sigma);
  return { whileInRange: poolAPR * factor, timeInRange: f, forecast: poolAPR * factor * f };
}

// ---------- Calculator simulation ----------
export function simulate(pos, poolAPR, sigma, days, priceChange) {
  const end = pos.startPrice * (1 + priceChange);
  const hodl = pos.capital / 2 + (pos.capital / 2) * (1 + priceChange);
  const lpValue = pos.value(end);
  const est = estimateAPR(poolAPR, pos.lower, pos.upper, pos.startPrice, sigma);
  const fees = pos.inRange(end) ? (pos.capital * est.whileInRange / 100 * days) / 365 : 0;   // in range at the end ⇒ earns while-in-range APR
  return { endPrice: end, hodl, hodlAllEth: pos.capital * (1 + priceChange), lpValue, fees, lpTotal: lpValue + fees, il: lpValue / hodl - 1, netVsHodl: lpValue + fees - hodl };
}

// ---------- Paper positions (plain JSON objects) ----------
export const posOf = (p) => new Position(p.capital, p.entryPrice, p.lower, p.upper);
export function derive(p) {
  const pos = posOf(p), open = !p.closedAt;
  const positionValue = pos.value(p.currentPrice);
  const hodl = p.capital / 2 + (p.capital / 2) * (p.currentPrice / p.entryPrice);
  const est = estimateAPR(p.poolAPR, p.lower, p.upper, p.currentPrice, p.sigma ?? DEFAULT_SIGMA);
  const totalValue = open ? positionValue + p.feesAccrued : p.closeValue;
  return { pos, open, positionValue, inRange: pos.inRange(p.currentPrice), hodl, il: positionValue / hodl - 1, est, totalValue, pnl: totalValue - p.capital };
}

// ---------- Aave scenario maths ----------
const isBTC = (s) => s.toUpperCase().includes('BTC');
const isETH = (s) => s.toUpperCase().includes('ETH');
function ltOf(p, acct) { return p.lt ?? acct.liqThreshold / 100; }
/** BTC price at which a network's position reaches `targetHF` (default 1.0 = liquidation), moving BTC alone. */
export function btcLiquidation(snap, chainId, btcPrice, targetHF = 1) {
  const acct = snap.accounts.find((a) => a.chainId === chainId);
  if (!acct || acct.healthFactor == null || acct.debtUSD <= 0) return null;
  const coll = snap.supplies.filter((s) => s.chainId === chainId && s.isCollateral);
  const w = (arr) => arr.reduce((t, s) => t + s.usd * ltOf(s, acct), 0);
  const wBTC = w(coll.filter((s) => isBTC(s.symbol))), wOther = w(coll.filter((s) => !isBTC(s.symbol)));
  if (wBTC <= 0) return null;
  const k = (acct.healthFactor * acct.debtUSD) / (wBTC + wOther);
  const f = (targetHF * acct.debtUSD - k * wOther) / (k * wBTC);
  if (acct.healthFactor <= targetHF) return { price: btcPrice, dropPct: 0 };
  if (f <= 0) return { price: null, dropPct: null };            // BTC alone can't trigger it
  return { price: btcPrice * f, dropPct: (f - 1) * 100 };
}
/** Health factor if BTC-like / ETH-like assets move by the given factors (others flat). */
export function healthAfter(snap, chainId, btcF, ethF) {
  const acct = snap.accounts.find((a) => a.chainId === chainId);
  if (!acct || acct.healthFactor == null || acct.debtUSD <= 0) return null;
  const f = (s) => (isBTC(s) ? btcF : isETH(s) ? ethF : 1);
  const coll = snap.supplies.filter((s) => s.chainId === chainId && s.isCollateral);
  const w0 = coll.reduce((t, s) => t + s.usd * ltOf(s, acct), 0); if (w0 <= 0) return null;
  const k = (acct.healthFactor * acct.debtUSD) / w0;
  const w1 = coll.reduce((t, s) => t + s.usd * f(s.symbol) * ltOf(s, acct), 0);
  const debt1 = snap.borrows.filter((b) => b.chainId === chainId).reduce((t, b) => t + b.usd * f(b.symbol), 0);
  return debt1 > 0 ? (k * w1) / debt1 : null;
}
export const aaveTotals = (snap) => {
  const supplied = snap.supplies.reduce((t, s) => t + s.usd, 0), borrowed = snap.borrows.reduce((t, b) => t + b.usd, 0), net = supplied - borrowed;
  const earn = snap.supplies.reduce((t, s) => t + s.usd * s.apy / 100, 0), cost = snap.borrows.reduce((t, b) => t + b.usd * b.apy / 100, 0);
  const hfs = snap.accounts.map((a) => a.healthFactor).filter((x) => x != null);
  return { supplied, borrowed, net, netAPY: net > 0 ? ((earn - cost) / net) * 100 : null, lowestHF: hfs.length ? Math.min(...hfs) : null };
};
