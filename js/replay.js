// ---------- Instellingen ----------
// Yahoo Finance via de nginx-proxy (zie nginx.conf), want Yahoo blokkeert directe browserverzoeken
const YAHOO_URL = '/api/yahoo/';
const CONTEXT_CANDLES = 200; // candles vóór het startmoment, zodat je context ziet
const PRELOAD_MARGIN = 100; // nieuwe data ophalen als er nog zo weinig candles over zijn
const DAY = 24 * 60 * 60; // seconden

// Per timeframe: hoeveel dagen Yahoo per verzoek teruggeeft (chunk)
// en hoe ver de data maximaal teruggaat (limit, null = geen limiet)
const TIMEFRAMES = {
  '1m': { chunk: 5, limit: 30 },
  '5m': { chunk: 20, limit: 60 },
  '15m': { chunk: 30, limit: 60 },
  '30m': { chunk: 30, limit: 60 },
  '1h': { chunk: 120, limit: 730 },
  '1d': { chunk: 3650, limit: null },
};

// ---------- Staat van de sessie ----------
const state = {
  source: 'yahoo',
  symbol: '',
  yahooSymbol: '',
  interval: '',
  multiplier: 1, // dollar per punt per contract
  strategy: '',
  fee: 0, // kosten per contract (heen en terug)
  startBalance: 0,
  candles: [], // alle geladen candles: { time (unix sec, UTC), open, high, low, close }
  index: 0, // index van de laatste zichtbare candle
  position: null, // open positie of null
  markers: [],
  sessionTrades: [],
  timer: null,
  loadingMore: false,
  endOfData: false,
};

let chart = null;
let series = null;

// ---------- Marktdata ophalen ----------
const nowSec = () => Math.floor(Date.now() / 1000);

// Vroegst mogelijke starttijd voor deze timeframe (met een uur marge)
function earliestStart(interval) {
  const { limit } = TIMEFRAMES[interval];
  return limit ? nowSec() - limit * DAY + 60 * 60 : 0;
}

// Haalt candles op tussen twee tijden (unix-seconden)
async function fetchCandles(yahooSymbol, interval, from, to) {
  const params = new URLSearchParams({ interval, period1: Math.floor(from), period2: Math.floor(to) });
  const response = await fetch(`${YAHOO_URL}${encodeURIComponent(yahooSymbol)}?${params}`);
  const data = await response.json().catch(() => ({}));
  const result = data.chart?.result?.[0];
  if (!response.ok || !result) {
    throw new Error(`Yahoo-fout: ${data.chart?.error?.description || response.status}`);
  }

  // Yahoo geeft losse lijsten terug: timestamp[] en quote.open[], quote.high[], ...
  const quote = result.indicators.quote[0];
  return (result.timestamp || [])
    .map((time, i) => ({
      time,
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
    }))
    // Lege candles (bv. tijdens een handelspauze) overslaan
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => v > 0));
}

// Zoekt vanaf een tijdstip vooruit naar de eerstvolgende candles (slaat weekenden over)
async function fetchForward(yahooSymbol, interval, from) {
  const chunk = TIMEFRAMES[interval].chunk * DAY;
  while (from < nowSec()) {
    const to = Math.min(from + chunk, nowSec());
    const candles = await fetchCandles(yahooSymbol, interval, from, to);
    if (candles.length) return candles;
    from = to;
  }
  return [];
}

async function loadYahoo(yahooSymbol, interval, startMs) {
  const start = startMs / 1000;
  const contextFrom = Math.max(start - TIMEFRAMES[interval].chunk * DAY, earliestStart(interval));

  const [context, future] = await Promise.all([
    fetchCandles(yahooSymbol, interval, contextFrom, start),
    fetchForward(yahooSymbol, interval, start),
  ]);
  const before = context.filter((c) => c.time < start).slice(-CONTEXT_CANDLES);
  const after = future.filter((c) => c.time >= start);
  if (!after.length) throw new Error('Er is geen data na dit startmoment. Kies een eerdere datum.');
  return { candles: [...before, ...after], index: Math.max(before.length - 1, 0) };
}

// Haalt de volgende reeks candles op zodra de replay bijna aan het eind is
async function loadMore() {
  if (state.source !== 'yahoo' || state.loadingMore || state.endOfData) return;
  state.loadingMore = true;
  try {
    const last = state.candles[state.candles.length - 1];
    const more = (await fetchForward(state.yahooSymbol, state.interval, last.time + 1)).filter(
      (c) => c.time > last.time
    );
    if (more.length) state.candles.push(...more);
    else state.endOfData = true;
  } catch {
    showMessage('Kon geen nieuwe data ophalen. Controleer je internetverbinding.');
  } finally {
    state.loadingMore = false;
  }
}

// ---------- CSV inlezen ----------
// Zet tijden als "2024.01.31 09:30", "31.01.2024 09:30" of een unix-timestamp om naar unix-seconden
function parseTime(value) {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 1e11 ? n / 1000 : n; // milliseconden of seconden
  }
  const normalized = value
    .replace(/^(\d{4})[./](\d{2})[./](\d{2})/, '$1-$2-$3')
    .replace(/^(\d{2})[./](\d{2})[./](\d{4})/, '$3-$2-$1')
    .replace(' ', 'T');
  const ms = Date.parse(normalized);
  return isNaN(ms) ? NaN : ms / 1000;
}

function parseCsv(text) {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, '')));

  // Zonder kopregel: tijd, open, high, low, close (date = aparte datumkolom, -1 = geen)
  let cols = { date: -1, time: 0, open: 1, high: 2, low: 3, close: 4 };

  const header = rows[0].map((h) => h.toLowerCase());
  if (header.some((h) => /open|close|time|date|datum/.test(h))) {
    const find = (regex) => header.findIndex((h) => regex.test(h));
    const dateCol = find(/^(date|datum)$/);
    const timeCol = header.findIndex((h, i) => i !== dateCol && /time|tijd/.test(h));
    cols = {
      open: find(/^open/),
      high: find(/^(high|hoog)/),
      low: find(/^(low|laag)/),
      close: find(/^(close|slot)/),
    };
    if (dateCol !== -1 && timeCol !== -1) {
      // Aparte kolommen voor datum en tijd (zoals bij MetaTrader)
      Object.assign(cols, { date: dateCol, time: timeCol });
    } else {
      Object.assign(cols, { date: -1, time: dateCol !== -1 ? dateCol : timeCol });
    }
    rows.shift();
  }

  if ([cols.time, cols.open, cols.high, cols.low, cols.close].includes(-1)) {
    throw new Error('Kon de kolommen tijd, open, high, low en close niet vinden.');
  }

  const candles = rows
    .map((r) => ({
      time: parseTime(cols.date !== -1 ? `${r[cols.date]} ${r[cols.time]}` : r[cols.time]),
      open: Number(r[cols.open]),
      high: Number(r[cols.high]),
      low: Number(r[cols.low]),
      close: Number(r[cols.close]),
    }))
    .filter((c) => !isNaN(c.time) && [c.open, c.high, c.low, c.close].every((v) => v > 0))
    .sort((a, b) => a.time - b.time)
    // Dubbele tijden verwijderen, de grafiek kan daar niet tegen
    .filter((c, i, list) => i === 0 || c.time !== list[i - 1].time);

  if (candles.length < 2) throw new Error('Het bestand bevat te weinig geldige candles.');
  return candles;
}

function loadCsv(candles, startMs) {
  let index;
  if (startMs) {
    const firstAfter = candles.findIndex((c) => c.time * 1000 >= startMs);
    if (firstAfter === -1) throw new Error('Het startmoment ligt na de laatste candle in het bestand.');
    index = Math.max(firstAfter - 1, 0);
  } else {
    // Geen startmoment: begin met een stukje context
    index = Math.min(CONTEXT_CANDLES, Math.floor(candles.length / 4));
  }
  return { candles, index };
}

// ---------- Grafiek ----------
// Lightweight Charts toont tijden in UTC; verschuif ze zodat je je eigen tijdzone ziet.
// Eén vaste verschuiving: per candle verschuiven geeft dubbele tijden bij de overgang
// naar wintertijd, en dan weigert de grafiek de data.
const TZ_SHIFT = new Date().getTimezoneOffset() * 60;

function chartTime(time) {
  return time - TZ_SHIFT;
}

function toChartCandle(c) {
  return { ...c, time: chartTime(c.time) };
}

// Aantal decimalen afhankelijk van de prijs (voor CSV-data; futures gebruiken ticks van 0.25)
function pricePrecision(price) {
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  return Math.min(8, Math.max(4, 2 - Math.floor(Math.log10(price)) + 2));
}

function formatPrice(price) {
  return price.toFixed(pricePrecision(price));
}

function createChart() {
  if (chart) chart.remove();

  chart = LightweightCharts.createChart(document.getElementById('chart'), {
    autoSize: true,
    layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
    grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5, borderColor: '#334155' },
    rightPriceScale: { borderColor: '#334155' },
  });

  // Futures bewegen in ticks van 0.25; andere markten krijgen decimalen op basis van de prijs
  const tickSize = CONTRACTS[state.symbol]?.tickSize;
  const precision = tickSize ? 2 : pricePrecision(state.candles[state.index].close);
  series = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
    borderVisible: false,
    priceFormat: { type: 'price', precision, minMove: tickSize || 1 / 10 ** precision },
  });

  // Alleen de candles tot het startmoment: geen spieken in de toekomst!
  series.setData(state.candles.slice(0, state.index + 1).map(toChartCandle));
  chart.timeScale().setVisibleLogicalRange({ from: state.index - 80, to: state.index + 5 });
}

function addMarker(marker) {
  state.markers.push({ ...marker, time: chartTime(marker.time) });
  series.setMarkers(state.markers);
}

// ---------- Replay afspelen ----------
function currentCandle() {
  return state.candles[state.index];
}

function nextCandle() {
  if (state.index >= state.candles.length - 1) {
    if (state.endOfData || state.source === 'csv') {
      pause();
      showMessage('Einde van de data bereikt.');
    } else {
      loadMore(); // doet niets als er al geladen wordt; probeert opnieuw na een fout
    }
    return;
  }

  state.index++;
  const candle = currentCandle();
  series.update(toChartCandle(candle));
  checkPosition(candle);
  render();

  if (state.candles.length - state.index < PRELOAD_MARGIN) loadMore();
}

function play() {
  pause();
  state.timer = setInterval(nextCandle, Number(speedSelect.value));
  playButton.textContent = '⏸ Pauze';
}

function pause() {
  clearInterval(state.timer);
  state.timer = null;
  playButton.textContent = '▶ Afspelen';
}

function togglePlay() {
  if (state.timer) pause();
  else play();
}

// ---------- Posities ----------
function openPosition(side) {
  showOrderError('');
  if (state.position) return showOrderError('Je hebt al een open positie. Sluit die eerst.');

  const entry = currentCandle().close;
  const quantity = Number(orderQty.value);
  const sl = orderSl.value ? Number(orderSl.value) : null;
  const tp = orderTp.value ? Number(orderTp.value) : null;

  if (!(quantity > 0)) return showOrderError('Aantal contracten moet groter dan 0 zijn.');
  if (CONTRACTS[state.symbol] && !Number.isInteger(quantity)) {
    return showOrderError('Futures handel je in hele contracten.');
  }
  if (side === 'long') {
    if (sl !== null && sl >= entry) return showOrderError('Bij een long moet de stop-loss onder de prijs liggen.');
    if (tp !== null && tp <= entry) return showOrderError('Bij een long moet de take-profit boven de prijs liggen.');
  } else {
    if (sl !== null && sl <= entry) return showOrderError('Bij een short moet de stop-loss boven de prijs liggen.');
    if (tp !== null && tp >= entry) return showOrderError('Bij een short moet de take-profit onder de prijs liggen.');
  }

  const lines = [series.createPriceLine({ price: entry, color: '#94a3b8', lineWidth: 1, title: 'Entry' })];
  if (sl !== null) {
    lines.push(series.createPriceLine({ price: sl, color: '#ef4444', lineWidth: 1, lineStyle: 2, title: 'SL' }));
  }
  if (tp !== null) {
    lines.push(series.createPriceLine({ price: tp, color: '#10b981', lineWidth: 1, lineStyle: 2, title: 'TP' }));
  }

  state.position = {
    side,
    entry,
    quantity,
    sl,
    tp,
    multiplier: state.multiplier,
    fees: state.fee * quantity, // kosten per contract × aantal contracten
    entryTime: currentCandle().time,
    lines,
  };
  addMarker({
    time: state.position.entryTime,
    position: side === 'long' ? 'belowBar' : 'aboveBar',
    shape: side === 'long' ? 'arrowUp' : 'arrowDown',
    color: side === 'long' ? '#10b981' : '#ef4444',
    text: side === 'long' ? 'Buy' : 'Sell',
  });
  render();
}

// Controleert bij elke nieuwe candle of de stop-loss of take-profit is geraakt
function checkPosition(candle) {
  const p = state.position;
  if (!p) return;

  const hitSl = p.sl !== null && (p.side === 'long' ? candle.low <= p.sl : candle.high >= p.sl);
  const hitTp = p.tp !== null && (p.side === 'long' ? candle.high >= p.tp : candle.low <= p.tp);

  // Raakt één candle allebei? We weten niet welke eerst was, dus nemen we het slechtste geval: de stop-loss
  if (hitSl) closePosition(p.sl, 'SL');
  else if (hitTp) closePosition(p.tp, 'TP');
}

function closePosition(exitPrice, reason = 'Handmatig') {
  const p = state.position;
  if (!p) return;

  let trade;
  try {
    trade = buildTrade(
      {
        date: new Date(p.entryTime * 1000).toISOString(),
        symbol: state.symbol,
        side: p.side,
        strategy: state.strategy,
        entry: p.entry,
        exit: exitPrice,
        quantity: p.quantity,
        fees: p.fees,
      },
      { source: 'replay', timeframe: state.interval, exitReason: reason }
    );
  } catch (err) {
    return showOrderError(err.message);
  }

  // Direct in het journaal opslaan
  const all = loadTrades();
  all.push(trade);
  if (!storeTrades(all)) showOrderError('Opslaan in het journaal mislukt. Staat privé-browsen aan?');

  state.sessionTrades.push(trade);
  p.lines.forEach((line) => series.removePriceLine(line));
  addMarker({
    time: currentCandle().time,
    position: p.side === 'long' ? 'aboveBar' : 'belowBar',
    shape: 'circle',
    color: trade.pnl >= 0 ? '#10b981' : '#ef4444',
    text: `${reason} ${formatMoney(trade.pnl)}`,
  });
  state.position = null;
  render();
}

// ---------- UI ----------
const setupSection = document.getElementById('setup');
const replaySection = document.getElementById('replay');
const setupForm = document.getElementById('setup-form');
const setupError = document.getElementById('setup-error');
const setupButton = document.getElementById('setup-button');
const playButton = document.getElementById('play-button');
const nextButton = document.getElementById('next-button');
const speedSelect = document.getElementById('speed-select');
const orderQty = document.getElementById('order-qty');
const orderSl = document.getElementById('order-sl');
const orderTp = document.getElementById('order-tp');
const orderError = document.getElementById('order-error');
const positionPanel = document.getElementById('position-panel');
const replayMessage = document.getElementById('replay-message');
const sessionList = document.getElementById('session-list');
const itemTemplate = document.getElementById('session-item');

const RESULT_COLORS = {
  win: 'text-emerald-400',
  loss: 'text-red-400',
  breakeven: 'text-slate-400',
};


function formatTime(time) {
  return new Date(time * 1000).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
}

function toggleMessage(el, message) {
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}
const showSetupError = (message) => toggleMessage(setupError, message);
const showOrderError = (message) => toggleMessage(orderError, message);
const showMessage = (message) => toggleMessage(replayMessage, message);

function setColor(el, value) {
  el.classList.remove(...Object.values(RESULT_COLORS));
  el.classList.add(RESULT_COLORS[getResult(value)]);
}

function render() {
  const candle = currentCandle();
  document.getElementById('replay-time').textContent = formatTime(candle.time);
  document.getElementById('current-price').textContent = formatPrice(candle.close);

  // Open positie
  const p = state.position;
  positionPanel.classList.toggle('hidden', !p);
  if (p) {
    const unrealized = calculatePnL({ ...p, exit: candle.close });
    document.getElementById('position-title').textContent =
      `${p.side.toUpperCase()} ${p.quantity} × ${state.symbol}`;
    document.getElementById('position-meta').textContent =
      `Entry ${formatPrice(p.entry)} · SL ${p.sl !== null ? formatPrice(p.sl) : '–'} · TP ${p.tp !== null ? formatPrice(p.tp) : '–'}`;
    const pnlEl = document.getElementById('position-pnl');
    pnlEl.textContent = formatMoney(unrealized);
    setColor(pnlEl, unrealized);
  }

  // Sessie-statistieken
  const trades = state.sessionTrades;
  const total = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const decided = trades.filter((t) => t.pnl !== 0).length;

  const balanceEl = document.getElementById('session-balance');
  balanceEl.textContent = formatMoney(state.startBalance + total);
  const pnlEl = document.getElementById('session-pnl');
  pnlEl.textContent = formatMoney(total);
  setColor(pnlEl, total);
  document.getElementById('session-winrate').textContent = (decided ? Math.round((wins / decided) * 100) : 0) + '%';
  document.getElementById('session-count').textContent = trades.length;

  // Sessielijst, nieuwste bovenaan
  document.getElementById('session-empty').classList.toggle('hidden', trades.length > 0);
  sessionList.replaceChildren(
    ...[...trades].reverse().map((t) => {
      const li = itemTemplate.content.firstElementChild.cloneNode(true);
      li.querySelector('[data-role="title"]').textContent = `${t.side.toUpperCase()} · ${t.exitReason}`;
      li.querySelector('[data-role="meta"]').textContent =
        `${formatTime(new Date(t.date) / 1000)} · ${formatPrice(t.entry)} → ${formatPrice(t.exit)}`;
      const pnl = li.querySelector('[data-role="pnl"]');
      pnl.textContent = formatMoney(t.pnl);
      setColor(pnl, t.pnl);
      return li;
    })
  );
}

// Laat alleen de velden zien die bij de gekozen markt horen (futures of CSV)
function updateSourceFields() {
  const source = setupForm.elements.source.value === 'csv' ? 'csv' : 'futures';
  setupForm.querySelectorAll('[data-source]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.source !== source);
  });
}

async function startSession(e) {
  e.preventDefault();
  showSetupError('');

  const form = Object.fromEntries(new FormData(setupForm));
  const startMs = form.start ? new Date(form.start).getTime() : null;
  const strategy = form.strategy.trim();
  const balance = Number(form.balance);
  const fee = Number(form.fee) || 0;

  if (!strategy) return showSetupError('Vul een strategie in, zodat je trades in het journaal te vergelijken zijn.');
  if (!(balance > 0)) return showSetupError('Startbalans moet groter dan 0 zijn.');
  if (fee < 0) return showSetupError('Kosten kunnen niet negatief zijn.');

  setupButton.disabled = true;
  setupButton.textContent = 'Data laden…';
  try {
    let loaded;
    if (form.source !== 'csv') {
      const contract = CONTRACTS[form.source];
      const { limit } = TIMEFRAMES[form.interval];
      if (!startMs) throw new Error('Kies een startmoment.');
      if (startMs > Date.now()) throw new Error('Het startmoment moet in het verleden liggen.');
      if (startMs / 1000 < earliestStart(form.interval)) {
        throw new Error(
          `Yahoo heeft ${form.interval}-data alleen van de laatste ${limit} dagen. ` +
            'Kies een later startmoment of een grotere timeframe.'
        );
      }
      loaded = await loadYahoo(contract.yahoo, form.interval, startMs);
      Object.assign(state, {
        source: 'yahoo',
        symbol: form.source,
        yahooSymbol: contract.yahoo,
        interval: form.interval,
      });
    } else {
      const file = setupForm.elements.file.files[0];
      if (!file) throw new Error('Kies een CSV-bestand.');
      loaded = loadCsv(parseCsv(await file.text()), startMs);
      const symbol = form.csvSymbol.trim().toUpperCase() || file.name.replace(/\.[^.]+$/, '').toUpperCase();
      Object.assign(state, { source: 'csv', symbol, interval: 'CSV' });
    }

    Object.assign(state, {
      multiplier: multiplierFor(state.symbol),
      strategy,
      fee,
      startBalance: balance,
      candles: loaded.candles,
      index: loaded.index,
      position: null,
      markers: [],
      sessionTrades: [],
      endOfData: false,
    });
  } catch (err) {
    showSetupError(
      err.message === 'Failed to fetch' ? 'Kon de koersdata niet ophalen. Controleer je internetverbinding.' : err.message
    );
    return;
  } finally {
    setupButton.disabled = false;
    setupButton.textContent = 'Start replay';
  }

  setupSection.classList.add('hidden');
  replaySection.classList.remove('hidden');
  document.getElementById('replay-title').textContent = `${state.symbol} · ${state.interval} · ${state.strategy}`;
  showMessage('');
  showOrderError('');
  createChart();
  render();
}

function stopSession() {
  pause();
  if (state.position) {
    if (!confirm('Je hebt nog een open positie. Sluiten op de huidige prijs?')) return;
    closePosition(currentCandle().close);
  }
  replaySection.classList.add('hidden');
  setupSection.classList.remove('hidden');
  fillStrategyOptions();
}

// Suggesties met strategieën die al in het journaal staan
function fillStrategyOptions() {
  const strategies = [...new Set(loadTrades().map((t) => t.strategy))].sort((a, b) => a.localeCompare(b));
  document.getElementById('strategy-options').replaceChildren(...strategies.map((s) => new Option(s)));
}

// Standaard startmoment: een werkdag van ongeveer een week geleden, 15:00
// (een half uur vóór de opening van de Amerikaanse beurs in Nederlandse tijd)
function defaultStart() {
  const d = new Date(Date.now() - 7 * DAY * 1000);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); // geen weekend
  d.setHours(15, 0, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

setupForm.addEventListener('submit', startSession);
setupForm.elements.source.addEventListener('change', updateSourceFields);
playButton.addEventListener('click', togglePlay);
nextButton.addEventListener('click', () => {
  pause();
  nextCandle();
});
speedSelect.addEventListener('change', () => state.timer && play());
document.getElementById('buy-button').addEventListener('click', () => openPosition('long'));
document.getElementById('sell-button').addEventListener('click', () => openPosition('short'));
document.getElementById('close-button').addEventListener('click', () => closePosition(currentCandle().close));
document.getElementById('stop-button').addEventListener('click', stopSession);

// Sneltoetsen op de laptop: spatie = afspelen/pauze, pijl rechts = volgende candle
document.addEventListener('keydown', (e) => {
  if (replaySection.classList.contains('hidden') || e.target.matches('input, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowRight') {
    pause();
    nextCandle();
  }
});

setupForm.elements.start.value = defaultStart();
updateSourceFields();
fillStrategyOptions();
