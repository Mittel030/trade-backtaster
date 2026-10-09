// Gedeelde trade-logica voor het journaal (app.js) en de replay (replay.js)
const STORAGE_KEY = 'trades';

// Futures-contracten: hoeveel dollar één punt koersbeweging waard is per contract
const CONTRACTS = {
  MNQ: { name: 'Micro E-mini Nasdaq-100', yahoo: 'MNQ=F', multiplier: 2, tickSize: 0.25 },
  MES: { name: 'Micro E-mini S&P 500', yahoo: 'MES=F', multiplier: 5, tickSize: 0.25 },
};

// Aandelen e.d. hebben geen vermenigvuldiger (1 punt = $1 per stuk)
function multiplierFor(symbol) {
  return CONTRACTS[symbol]?.multiplier ?? 1;
}

function formatMoney(value) {
  return (value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
}

// ---------- P&L berekenen ----------
function calculatePnL({ side, entry, exit, quantity, fees = 0, multiplier = 1 }) {
  const priceDiff = side === 'long' ? exit - entry : entry - exit;
  // Afronden op centen voorkomt floating-point resten zoals 0.30000000000000004
  return Math.round((priceDiff * quantity * multiplier - fees) * 100) / 100;
}

// Winst, verlies of break-even (P&L van precies 0)
function getResult(pnl) {
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'breakeven';
}

// ---------- Opslag ----------
function loadTrades() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // P&L opnieuw berekenen, zodat oude trades ook de huidige berekening volgen
    return stored.map((t) => {
      const trade = { ...t, multiplier: t.multiplier ?? multiplierFor(t.symbol) };
      return { ...trade, pnl: calculatePnL(trade) };
    });
  } catch {
    return [];
  }
}

// Geeft false terug als opslaan mislukt (bv. in privé-modus)
function storeTrades(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// ---------- Validatie ----------
function validateTrade(data) {
  const errors = [];
  if (!data.symbol || !data.symbol.trim()) errors.push('Vul een symbool in.');
  if (!data.strategy || !data.strategy.trim()) errors.push('Vul een strategie in.');
  if (!['long', 'short'].includes(data.side)) errors.push('Kies long of short.');
  if (!(Number(data.entry) > 0)) errors.push('Entry prijs moet groter dan 0 zijn.');
  if (!(Number(data.exit) > 0)) errors.push('Exit prijs moet groter dan 0 zijn.');
  if (!(Number(data.quantity) > 0)) errors.push('Aantal moet groter dan 0 zijn.');
  if (data.fees && !(Number(data.fees) >= 0)) errors.push('Kosten kunnen niet negatief zijn.');
  if (!data.date || isNaN(new Date(data.date))) errors.push('Vul een geldige datum en tijd in.');
  return errors;
}

// Maakt een trade-object van formulierdata; gooit een fout bij ongeldige invoer
function buildTrade(data, extra = {}) {
  const errors = validateTrade(data);
  if (errors.length) throw new Error(errors.join(' '));

  const symbol = data.symbol.trim().toUpperCase();
  const trade = {
    // Tijd + willekeurig stukje, zodat twee snelle trades nooit hetzelfde id krijgen
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date(data.date).toISOString(),
    symbol,
    side: data.side,
    strategy: data.strategy.trim(),
    entry: Number(data.entry),
    exit: Number(data.exit),
    quantity: Number(data.quantity),
    fees: Number(data.fees) || 0,
    multiplier: multiplierFor(symbol),
    ...extra,
  };
  trade.pnl = calculatePnL(trade);
  return trade;
}
