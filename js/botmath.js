// Paper trading bot engine — pure logic, mirrors BotEngine.swift in the Mac app.
export const WARM_UP = 250, DCA_SLICES = 10;
export const STRATEGIES = {
  trend: { name: 'Trend following', rules: 'Moving-average crossover: holds the coin while the 20-candle average is above the 50-candle average, otherwise holds cash. Tends to do well in long moves and lose to fees in choppy markets.' },
  rsi: { name: 'RSI mean reversion', rules: 'Buys when the 14-candle RSI drops below 30 (oversold) and sells when it rises above 70 (overbought). Suits sideways markets; in a strong fall it can buy far too early.' },
  dca: { name: 'Dollar-cost averaging', rules: 'Splits the money into 10 equal buys, one a week (daily candles) or one a day (hourly candles), and never sells. A simple baseline that ignores timing.' },
};

export function sma(v, n) {
  let sum = 0;
  return v.map((x, i) => { sum += x; if (i >= n) sum -= v[i - n]; return i >= n - 1 ? sum / n : null; });
}
/** Wilder's RSI. */
export function rsi(v, n) {
  const out = v.map(() => null); if (v.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  gain /= n; loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n; loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

/**
 * Replays a bot over candles [{time (ms), open, close}], oldest first. A decision uses only candles that have closed and is
 * filled at the next candle's opening price, so the bot never trades on a price it couldn't have had.
 * bot: { coin, strategy, interval (seconds), capital, feePct, startedAt, stoppedAt, stopPrice }
 */
export function runBot(bot, candles, now = Date.now()) {
  const r = { trades: [], curve: [], cash: bot.capital, units: 0, value: bot.capital, holdValue: bot.capital, fees: 0, maxDropPct: 0, signal: 'not enough price history yet' };
  const end = bot.stoppedAt || now, all = candles.filter((c) => c.time <= end), closes = all.map((c) => c.close);
  const fast = sma(closes, 20), slow = sma(closes, 50), strength = rsi(closes, 14), fee = bot.feePct / 100;
  const dcaEvery = bot.interval === 86400 ? 7 : 24;
  let bought = 0, since = 0, holdUnits = 0, peak = bot.capital;
  const buy = (spend, c, reason) => {
    if (!(spend > 0.01)) return;
    const cost = spend * fee, units = (spend - cost) / c.open;
    r.cash -= spend; r.units += units; r.fees += cost;
    r.trades.push({ time: c.time, buy: true, price: c.open, units, value: spend, fee: cost, reason });
  };
  const sell = (price, time, reason) => {
    if (!(r.units > 0)) return;
    const gross = r.units * price, cost = gross * fee;
    r.trades.push({ time, buy: false, price, units: r.units, value: gross - cost, fee: cost, reason });
    r.cash += gross - cost; r.fees += cost; r.units = 0;
  };
  // The first tradable candle is the first one that opens after the bot started.
  let first = all.findIndex((c, i) => i > 0 && c.time >= bot.startedAt); if (first < 0) first = all.length;
  for (let i = first; i < all.length; i++) {
    const c = all[i], s = i - 1;                                   // s: the last closed candle when this one opens
    if (bot.strategy === 'trend') {
      if (fast[s] != null && slow[s] != null) {
        if (fast[s] > slow[s] && r.units === 0) buy(r.cash, c, '20 average above 50 average');
        else if (fast[s] < slow[s] && r.units > 0) sell(c.open, c.time, '20 average fell below 50 average');
      }
    } else if (bot.strategy === 'rsi') {
      const x = strength[s];
      if (x != null) {
        if (x < 30 && r.units === 0) buy(r.cash, c, `RSI ${x.toFixed(0)}, below 30`);
        else if (x > 70 && r.units > 0) sell(c.open, c.time, `RSI ${x.toFixed(0)}, above 70`);
      }
    } else {
      if (bought < DCA_SLICES && (bought === 0 || since >= dcaEvery)) {
        buy(Math.min(bot.capital / DCA_SLICES, r.cash), c, `Scheduled buy ${bought + 1} of ${DCA_SLICES}`);
        bought++; since = 0;
      }
      since++;
    }
    if (holdUnits === 0) holdUnits = (bot.capital * (1 - fee)) / c.open;
    r.value = r.cash + r.units * c.close; r.holdValue = holdUnits * c.close;
    peak = Math.max(peak, r.value); r.maxDropPct = Math.max(r.maxDropPct, (1 - r.value / peak) * 100);
    r.curve.push({ time: c.time, bot: r.value, hold: r.holdValue });
  }
  if (bot.stoppedAt && all.length) { const price = bot.stopPrice || all.at(-1).close;
    if (r.curve.length) { r.holdValue *= price / all.at(-1).close; }
    sell(price, end, 'Bot stopped'); r.value = r.cash; }   // sells what it still holds
  const s = all.length - 1;
  if (bot.strategy === 'trend' && fast[s] != null && slow[s] != null) r.signal = `20 average is ${(Math.abs(fast[s] / slow[s] - 1) * 100).toFixed(1)}% ${fast[s] > slow[s] ? 'above' : 'below'} the 50 average`;
  else if (bot.strategy === 'rsi' && strength[s] != null) r.signal = `RSI is ${strength[s].toFixed(0)} (buys below 30, sells above 70)`;
  else if (bot.strategy === 'dca') r.signal = `${bought} of ${DCA_SLICES} buys made`;
  return r;
}

/** Candles for a bot: Coinbase public market data, 300 a request, rows [time, low, high, open, close, volume]. */
export async function fetchCandles(coin, interval, from, to, fetcher = fetch) {
  const out = new Map(), step = interval * 1000;
  for (let a = from; a < to;) {
    const b = Math.min(a + step * 299, to);
    const url = `https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=${interval}&start=${new Date(a).toISOString()}&end=${new Date(b).toISOString()}`;
    let res = await fetcher(url);
    if (res.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); res = await fetcher(url); }
    if (!res.ok) throw new Error(res.status === 429 ? 'Rate limited by the price provider — will retry.' : `Price provider returned HTTP ${res.status}.`);
    for (const row of await res.json()) if (row[3] > 0 && row[4] > 0) out.set(row[0] * 1000, { time: row[0] * 1000, open: row[3], close: row[4] });
    a = b + 1000;
    if (a < to) await new Promise((ok) => setTimeout(ok, 150));       // be gentle with the free API
  }
  return [...out.values()].sort((x, y) => x.time - y.time);
}
