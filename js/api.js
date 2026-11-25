// Data layer: CoinGecko (prices), GeckoTerminal (Uniswap pools), Aave API + on-chain reads.
import { num, sleep, load, save } from './util.js';

export class RateLimited extends Error { constructor(m = 'Rate limited by the data provider — will retry automatically.') { super(m); this.rateLimited = true; } }

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 429) throw new RateLimited();
  if (!r.ok) throw new Error(`Server returned HTTP ${r.status}.`);
  return r.json();
}
export async function getRetry(url) {
  try { return await getJSON(url); }
  catch (e) { if (e.rateLimited) { await sleep(3000); return getJSON(url); } throw e; }
}

// ---------- CoinGecko ----------
export async function fetchCoins() {
  const arr = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=true&price_change_percentage=24h,7d');
  const coins = arr.map((d) => ({
    id: d.id, symbol: String(d.symbol).toUpperCase(), name: d.name, price: d.current_price,
    change24h: d.price_change_percentage_24h_in_currency ?? d.price_change_percentage_24h,
    change7d: d.price_change_percentage_7d_in_currency, high24h: d.high_24h, low24h: d.low_24h,
    marketCap: d.market_cap, volume24h: d.total_volume,
  }));
  return coins.sort((a) => (a.id === 'bitcoin' ? -1 : 1));
}
export async function fetchHistory(id, days) {
  const d = await getJSON(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
  return (d.prices || []).map(([t, p]) => ({ t, p }));
}

// ---------- GeckoTerminal ----------
export const NETWORKS = [
  { id: 'eth', label: 'Ethereum' }, { id: 'arbitrum', label: 'Arbitrum' }, { id: 'base', label: 'Base' },
  { id: 'optimism', label: 'Optimism' }, { id: 'polygon_pos', label: 'Polygon' },
];
const DEXES = {
  eth: ['uniswap_v3', 'uniswap_v2', 'uniswap-v4-ethereum'],
  arbitrum: ['uniswap_v3_arbitrum', 'uniswap-v4-arbitrum'],
  base: ['uniswap-v3-base', 'uniswap-v4-base', 'uniswap-v2-base'],
  optimism: ['uniswap_v3_optimism', 'uniswap-v4-optimism'],
  polygon_pos: ['uniswap_v3_polygon_pos', 'uniswap-v4-polygon'],
};
export function parsePool(d, network) {
  const a = d.attributes; if (!a || !a.address) return null;
  const dex = d.relationships?.dex?.data?.id || '';
  const name = a.name || a.address;
  let fee = num(a.pool_fee_percentage);
  if (fee == null) { const m = name.match(/([0-9.]+)%\s*$/); if (m) fee = parseFloat(m[1]); }
  if (fee == null && dex.includes('v2')) fee = 0.3;
  const tx = a.transactions?.h24;
  return {
    network, address: a.address, name, dex, id: `${network}:${a.address}`,
    tvl: num(a.reserve_in_usd) || 0, volume24h: num(a.volume_usd?.h24) || 0,
    priceChange24h: num(a.price_change_percentage?.h24), feePercent: fee,
    txns24h: tx ? (tx.buys || 0) + (tx.sells || 0) : null,
    basePriceUSD: num(a.base_token_price_usd), quotePriceUSD: num(a.quote_token_price_usd),
  };
}
export const isUniswap = (p) => p.dex.toLowerCase().includes('uniswap');
export const version = (p) => (p.dex.includes('v4') ? 'V4' : p.dex.includes('v3') ? 'V3' : p.dex.includes('v2') ? 'V2' : '?');
export const poolAPR24 = (p) => (p.feePercent != null && p.tvl > 0 ? (p.volume24h * (p.feePercent / 100)) / p.tvl * 365 * 100 : null);

export async function fetchTopPools(network) {
  const out = []; let lastErr = null, gotAny = false;
  const dexes = DEXES[network] || [];
  for (let i = 0; i < dexes.length; i++) {
    if (i > 0) await sleep(600);
    try {
      const root = await getRetry(`https://api.geckoterminal.com/api/v2/networks/${network}/dexes/${dexes[i]}/pools?page=1&sort=h24_volume_usd_desc`);
      (root.data || []).forEach((d) => { const p = parsePool(d, network); if (p) out.push(p); });
      gotAny = true;
    } catch (e) { lastErr = e; }   // one failing dex shouldn't hide the others
  }
  if (!gotAny && lastErr) throw lastErr;
  return out.filter(isUniswap).sort((a, b) => b.tvl - a.tvl);
}
export async function fetchPools(network, addresses) {
  if (!addresses.length) return [];
  const root = await getJSON(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/multi/${addresses.join(',')}`);
  return (root.data || []).map((d) => parsePool(d, network)).filter(Boolean);
}
/** Top pools with a localStorage cache so the app still works when the provider rate-limits us. */
export async function topPoolsCached(network) {
  const key = `cache:top:${network}`;
  try {
    const pools = await fetchTopPools(network);
    save(key, { t: Date.now(), pools });
    return { pools, cached: false, t: Date.now() };
  } catch (e) {
    const c = load(key, null);
    if (c?.pools?.length) return { pools: c.pools, cached: true, t: c.t, error: e.message };
    throw e;
  }
}

// ---------- Paper-trading helpers (volatile/stablecoin pools only) ----------
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDBC', 'USDS', 'USDE', 'GHO', 'FRAX', 'LUSD', 'USDC.E', 'USDT0', 'PYUSD', 'USDTB', 'CRVUSD', 'OUSD', 'USDM', 'USD+', 'DOLA', 'SUSD', 'EURC', 'AUSD', 'USDX']);
const isStable = (s) => STABLES.has(String(s).toUpperCase());
function splitName(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split(' / ');
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].replace(/\s*[0-9.]+%\s*$/, '').trim()];
}
/** {symbol, price} of the volatile token, or null if the pool isn't volatile/stable. */
export function paperInfo(p) {
  const s = p && splitName(p.name); if (!s) return null;
  const [base, quote] = s; const bs = isStable(base), qs = isStable(quote);
  if (bs === qs) return null;
  const pegged = (x) => x > 0.97 && x < 1.03;
  if (bs) { const px = p.quotePriceUSD; return px > 0 && !pegged(px) ? { symbol: quote, price: px } : null; }
  const px = p.basePriceUSD; return px > 0 && !pegged(px) ? { symbol: base, price: px } : null;
}
export const volatileIsQuote = (p) => { const s = splitName(p.name); return !!s && isStable(s[0]); };

/** 7-day average volume + daily volatility from daily candles. */
export async function fetchPoolStats(p) {
  const root = await getRetry(`https://api.geckoterminal.com/api/v2/networks/${p.network}/pools/${p.address}/ohlcv/day?aggregate=1&limit=10&currency=usd&token=${volatileIsQuote(p) ? 'quote' : 'base'}`);
  const list = root.data?.attributes?.ohlcv_list || [];
  const rows = list.map((r) => ({ c: num(r[4]), v: num(r[5]) })).filter((r) => r.c > 0 && r.v != null);
  if (rows.length < 4) return null;
  const completed = rows.slice(1, 8);                                 // skip today's partial candle
  const avgVolume7d = completed.reduce((s, r) => s + r.v, 0) / completed.length;
  const closes = rows.map((r) => r.c).reverse();
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
  return { avgVolume7d, sigmaDaily: Math.max(0.004, Math.sqrt(variance)), days: completed.length, fetched: Date.now() };
}

// ---------- Aave V3 ----------
export const AAVE_CHAINS = [
  { id: 1, name: 'Ethereum', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', rpc: 'https://ethereum-rpc.publicnode.com' },
  { id: 8453, name: 'Base', pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: 'https://base-rpc.publicnode.com' },
  { id: 42161, name: 'Arbitrum', pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { id: 10, name: 'Optimism', pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: 'https://optimism-rpc.publicnode.com' },
  { id: 137, name: 'Polygon', pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { id: 43114, name: 'Avalanche', pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
];
export const chainName = (id) => AAVE_CHAINS.find((c) => c.id === id)?.name || `Chain ${id}`;
export const isValidAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);

async function gql(query) {
  const r = await fetch('https://api.v3.aave.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors?.length) throw new Error('Aave API: ' + j.errors[0].message);
  return j.data;
}
async function fetchPositions(addr) {
  const markets = AAVE_CHAINS.map((c) => `{address:"${c.pool}",chainId:${c.id}}`).join(',');
  const sel = 'market{chain{chainId}} currency{symbol}';
  const d = await gql(`{ s: userSupplies(request:{markets:[${markets}],user:"${addr}",collateralsOnly:false,orderBy:{balance:DESC}}) { ${sel} balance{amount{value} usd} apy{value} isCollateral }
    b: userBorrows(request:{markets:[${markets}],user:"${addr}",orderBy:{debt:DESC}}) { ${sel} debt{amount{value} usd} apy{value} } }`);
  const parse = (arr, key, supply) => (arr || []).map((r) => {
    const usd = num(r[key]?.usd), amount = num(r[key]?.amount?.value);
    if (usd == null || usd < 0.01) return null;
    return { chainId: r.market.chain.chainId, symbol: r.currency.symbol, amount, usd, apy: (num(r.apy?.value) || 0) * 100, isCollateral: supply ? !!r.isCollateral : false, lt: null };
  }).filter(Boolean);
  return { supplies: parse(d.s, 'balance', true), borrows: parse(d.b, 'debt', false) };
}
async function fetchThresholds() {
  const ids = AAVE_CHAINS.map((c) => c.id).join(',');
  const d = await gql(`{ markets(request:{chainIds:[${ids}]}){ chain{chainId} reserves{ underlyingToken{symbol} supplyInfo{liquidationThreshold{value}} } } }`);
  const out = {};
  for (const m of d.markets || []) for (const r of m.reserves || []) {
    const v = num(r.supplyInfo?.liquidationThreshold?.value);
    if (v != null) (out[m.chain.chainId] ||= {})[r.underlyingToken.symbol] = v;
  }
  return out;
}
async function accountData(chain, addr) {
  const data = '0xbf92857c' + '0'.repeat(24) + addr.slice(2).toLowerCase();
  const r = await fetch(chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: chain.pool, data }, 'latest'] }) });
  const j = await r.json(); const hex = (j.result || '').slice(2);
  if (hex.length < 64 * 6) throw new Error('bad rpc');
  const word = (i) => hex.slice(i * 64, (i + 1) * 64);
  const val = (i) => Number(BigInt('0x' + word(i)));
  const noDebt = /^f+$/.test(word(5));
  return { chainId: chain.id, collateralUSD: val(0) / 1e8, debtUSD: val(1) / 1e8, availableBorrowsUSD: val(2) / 1e8, liqThreshold: val(3) / 100, ltv: val(4) / 100, healthFactor: noDebt ? null : val(5) / 1e18 };
}
export async function fetchAave(address) {
  const [pos, lt, accts] = await Promise.all([
    fetchPositions(address),
    fetchThresholds().catch(() => ({})),
    Promise.all(AAVE_CHAINS.map((c) => accountData(c, address).catch(() => null))),
  ]);
  pos.supplies.forEach((s) => { s.lt = lt[s.chainId]?.[s.symbol] ?? null; });
  const accounts = accts.filter((a) => a && (a.collateralUSD > 0 || a.debtUSD > 0)).sort((a, b) => b.collateralUSD - a.collateralUSD);
  return { address, supplies: pos.supplies, borrows: pos.borrows, accounts, fetched: Date.now() };
}
