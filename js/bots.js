// Bots tab: fake-money trading bots. Their settings sync between devices; trades are replayed from price history.
import { h, usd, cls, ago, save, on, emit } from './util.js';
import { S } from './state.js';
import { STRATEGIES, WARM_UP, runBot, fetchCandles } from './botmath.js';
import { lineChart } from './charts.js';
import { signed } from './dialogs.js';

const INTERVALS = [[3600, 'Hourly'], [86400, 'Daily']];
const intervalName = (s) => (s === 3600 ? 'Hourly' : 'Daily');

export function mount(root) {
  const results = {}, cache = {}, openTrades = new Set();
  let coin = 'BTC', strategy = 'trend', interval = 86400, days = 365, busy = false, again = false, error = '', checked = null, testing = false, test = null, testError = '';
  const persist = () => { save('bots', S.bots); emit('bots'); };         // S.bots is replaced when sync brings changes

  // Fetch only what's missing; always the same warm-up window per bot, so its trades don't change between visits.
  async function candles(c, step, start, end) {
    const from = start - WARM_UP * step * 1000, key = `${c}:${step}`;
    let have = cache[key] || [];
    const wanted = have.length ? [[from, have[0].time, from < have[0].time], [have.at(-1).time, end, end > have.at(-1).time]].filter((w) => w[2]) : [[from, end]];
    for (const [a, b] of wanted) {
      const byTime = new Map(have.map((x) => [x.time, x]));
      for (const x of await fetchCandles(c, step, a, b)) byTime.set(x.time, x);
      have = [...byTime.values()].sort((x, y) => x.time - y.time);
    }
    cache[key] = have;
    return have.filter((x) => x.time >= from && x.time <= end);
  }
  async function refresh() {
    if (busy) { again = true; return; }
    busy = true; error = ''; drawList();
    for (const bot of [...S.bots]) {
      if (bot.stoppedAt && results[bot.id]?.stoppedAt === bot.stoppedAt) continue;     // can't change any more
      try {
        const c = await candles(bot.coin, bot.interval, bot.startedAt, bot.stoppedAt || Date.now());
        const now = S.bots.find((x) => x.id === bot.id); if (now) results[bot.id] = { ...runBot(now, c), stoppedAt: now.stoppedAt };
      } catch (e) { error = e.message; }
      drawList();
    }
    busy = false; checked = Date.now(); drawList();
    if (again) { again = false; refresh(); }
  }

  // ----- setup -----
  const coinSeg = h('div', { class: 'seg' }), stratBox = h('div', { class: 'col' }), intSeg = h('div', { class: 'seg' }), daySeg = h('div', { class: 'seg' }), testBox = h('div', { class: 'stack' });
  const amountIn = h('input', { type: 'number', min: 0, step: 'any', value: 1000, oninput: () => drawSetup() });
  const feeIn = h('input', { type: 'number', min: 0, max: 10, step: 0.1, value: 0.5, oninput: () => drawSetup() });
  const testBtn = h('button', { class: 'pill', onclick: runTest }, '↺ Test');
  const startBtn = h('button', { class: 'pill filled', onclick: start }, '▶ Start paper bot');
  const setup = h('div', { class: 'card stack', style: { '--glow': 'var(--cyan)' } },
    h('div', { class: 'eyebrow' }, 'NEW PAPER BOT'), coinSeg,
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Strategy'), stratBox),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Candles (how often it decides)'), intSeg),
    h('div', { class: 'row gap' }, h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, 'Fake money (USD)'), amountIn), h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, 'Fee per trade (%)'), feeIn)),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Test on past prices first'), daySeg),
    h('div', { class: 'split' }, testBtn, startBtn), testBox);

  const draft = () => ({ coin, strategy, interval, capital: +amountIn.value, feePct: feeIn.value === '' ? NaN : +feeIn.value, startedAt: Date.now(), stoppedAt: null });
  const valid = () => { const d = draft(); return d.capital > 0 && d.feePct >= 0 && d.feePct < 10; };
  const seg = (el, options, value, pick) => el.replaceChildren(...options.map(([v, label]) => h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { pick(v); drawSetup(); } }, label)));
  function drawSetup() {
    seg(coinSeg, [['BTC', 'Bitcoin'], ['ETH', 'Ethereum']], coin, (v) => { coin = v; });
    seg(intSeg, INTERVALS, interval, (v) => { interval = v; });
    seg(daySeg, [[90, '90 days'], [365, '1 year'], [730, '2 years']], days, (v) => { days = v; });
    stratBox.replaceChildren(...Object.entries(STRATEGIES).map(([id, s]) => h('button', { type: 'button', class: 'choice' + (strategy === id ? ' on' : ''), onclick: () => { strategy = id; drawSetup(); } },
      h('b', {}, s.name), strategy === id ? h('span', { class: 'muted small' }, s.rules) : null)));
    testBtn.disabled = !valid() || testing; testBtn.textContent = testing ? 'Testing…' : '↺ Test'; startBtn.disabled = !valid();
    testBox.replaceChildren(testError ? h('div', { class: 'banner' }, testError) : null, test ? h('div', { class: 'stack' }, h('hr'),
      h('div', { class: 'eyebrow' }, `PAST TEST · ${test.bot.coin} · ${STRATEGIES[test.bot.strategy].name} · ${intervalName(test.bot.interval).toLowerCase()} · last ${test.days} days`),
      numbers(test.bot, test.r), chart(test.r), h('div', { class: 'muted small' }, "A replay with today's knowledge. Trying settings until one looks good tends to flatter it.")) : null);
  }
  async function runTest() {
    const bot = draft(), span = days; testing = true; testError = ''; drawSetup();
    try {
      bot.startedAt = Date.now() - span * 86400000;
      test = { bot, days: span, r: runBot(bot, await candles(bot.coin, bot.interval, bot.startedAt, Date.now())) };
    } catch (e) { testError = e.message; }
    testing = false; drawSetup();
  }
  function start() { S.bots.unshift({ ...draft(), id: crypto.randomUUID() }); persist(); }
  // The price is saved with the stop, so every device shows the same final sale.
  async function stopBot(id) {
    const bot = S.bots.find((x) => x.id === id); if (!bot || bot.stoppedAt) return;
    let price = null;
    try { price = (await candles(bot.coin, bot.interval, bot.startedAt, Date.now())).at(-1)?.close ?? null; } catch { /* use the candle's price */ }
    const now = S.bots.find((x) => x.id === id); if (!now || now.stoppedAt) return;
    now.stoppedAt = Date.now(); now.stopPrice = price; persist();
  }

  // ----- running bots -----
  const stat = (l, v, c = '') => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, l), h('b', { class: c }, v));
  function numbers(bot, r) {
    const pnl = r.value - bot.capital, vs = r.value - r.holdValue;
    return h('div', { class: 'row gap wrap' }, stat('Value', usd(r.value)), stat('Profit / loss', signed(pnl), cls(pnl)), stat('Return', `${((pnl / bot.capital) * 100).toFixed(1)}%`, cls(pnl)),
      stat('Buy and hold', usd(r.holdValue)), stat('vs hold', signed(vs), cls(vs)), stat('Trades', String(r.trades.length)), stat('Fees paid', usd(r.fees)), stat('Biggest drop', `-${r.maxDropPct.toFixed(1)}%`));
  }
  function chart(r) {
    if (r.curve.length < 2) return null;
    const step = Math.max(1, Math.floor(r.curve.length / 300)), pts = r.curve.filter((_, i) => i % step === 0 || i === r.curve.length - 1);
    const line = (name, color, key) => ({ name, color, pts: pts.map((p) => ({ x: p.time, y: p[key] })) });
    return h('div', { html: lineChart([line('Bot', '#00e5f2', 'bot'), line('Buy and hold', '#8a93a6', 'hold')],
      { legend: true, fmtX: (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }), fmtY: (v) => `$${v.toFixed(0)}` }) });
  }
  function row(bot) {
    const r = results[bot.id], running = !bot.stoppedAt;
    const stop = () => { if (confirm("Stop this bot? It sells anything it holds at the current price and can't be restarted.")) stopBot(bot.id); };
    const del = () => { if (confirm('Delete this bot? Its results and trade list are removed.')) { S.bots = S.bots.filter((x) => x.id !== bot.id); delete results[bot.id]; persist(); } };
    return h('div', { class: 'subcard' },
      h('div', { class: 'split wrap' }, h('div', { class: 'row gap wrap' }, h('b', { class: 'big-name' }, `${bot.coin} · ${STRATEGIES[bot.strategy].name}`), h('span', { class: 'muted small' }, intervalName(bot.interval)),
        h('span', { class: 'badge ' + (running ? 'up' : 'muted') }, running ? 'RUNNING' : 'STOPPED')),
        h('span', { class: 'muted small' }, `started ${ago(bot.startedAt)} with ${usd(bot.capital)}`)),
      r ? [numbers(bot, r), h('div', { class: 'muted small' }, !r.curve.length
          ? `Waiting for the next ${bot.interval === 3600 ? 'hourly candle, which opens on the hour' : 'daily candle, which opens at midnight UTC'}, before the first decision · ${r.signal}`
          : `${r.units > 0 ? `Holding ${r.units.toPrecision(5)} ${bot.coin}` : 'Holding cash'} · ${r.signal}`), chart(r),
        openTrades.has(bot.id) ? h('div', { class: 'tablewrap tradelist' }, h('table', {}, h('tr', {}, ['Date', 'Side', 'Price', 'Amount', 'Fee', 'Why'].map((x) => h('th', {}, x))),
          [...r.trades].reverse().map((t) => h('tr', {}, h('td', {}, new Date(t.time).toLocaleString([], bot.interval === 3600 ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })),
            h('td', { class: t.buy ? 'up' : 'down' }, t.buy ? 'BUY' : 'SELL'), h('td', {}, usd(t.price)), h('td', {}, usd(t.value)), h('td', {}, usd(t.fee)), h('td', {}, t.reason))))) : null]
        : h('div', { class: 'muted small' }, 'Loading prices…'),
      h('div', { class: 'split' }, h('button', { class: 'pill', disabled: !r?.trades.length, onclick: () => { openTrades.has(bot.id) ? openTrades.delete(bot.id) : openTrades.add(bot.id); drawList(); } }, openTrades.has(bot.id) ? 'Hide trades' : 'Trades'),
        running ? h('button', { class: 'pill danger', onclick: stop }, '■ Stop') : h('button', { class: 'pill danger', onclick: del }, 'Delete')));
  }
  const list = h('div', { class: 'card stack', style: { '--glow': 'var(--up)' } });
  function drawList() {
    list.replaceChildren(h('div', { class: 'split' }, h('div', { class: 'eyebrow', style: { color: 'var(--up)' } }, `YOUR BOTS (${S.bots.length})`), h('span', { class: 'muted small' }, busy ? 'checking…' : checked ? `checked ${ago(checked)}` : '')),
      error ? h('div', { class: 'banner' }, error) : null,
      S.bots.length ? S.bots.map(row) : h('div', { class: 'center pad muted' }, 'No bots yet. Pick a strategy, test it on past prices, then start it with fake money.'));
  }

  root.append(h('div', { class: 'two paper' }, setup, list),
    h('div', { class: 'muted small' }, 'Paper trading bots use fake money only: nothing connects to an exchange account or places a real order. Prices are from Coinbase. Trades are replayed from price history, ignore slippage, and past results do not predict future ones. On the signed-in site, bots sync between your devices. Not financial advice.'));
  drawSetup(); drawList();
  setInterval(() => { if (!document.hidden && !root.hidden && S.bots.length) refresh(); }, 300000);
  on('bots', () => { drawList(); refresh(); });
  return { show() { refresh(); } };
}
