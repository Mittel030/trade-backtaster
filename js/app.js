const STORAGE_KEY = 'trades';

// Trades worden opgeslagen in localStorage, zodat ze blijven na herladen
let trades = loadTrades();

function loadTrades() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTrades() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

// ---------- Functie 1: trade loggen ----------
function logTrade(data) {
  const trade = {
    id: Date.now(),
    date: new Date().toISOString(),
    symbol: data.symbol.trim().toUpperCase(),
    side: data.side,
    strategy: data.strategy.trim(),
    entry: Number(data.entry),
    exit: Number(data.exit),
    quantity: Number(data.quantity),
    fees: Number(data.fees) || 0,
  };
  trade.pnl = calculatePnL(trade);
  trades.push(trade);
  saveTrades();
  return trade;
}

// ---------- Functie 2: P&L berekenen ----------
function calculatePnL({ side, entry, exit, quantity, fees }) {
  const priceDiff = side === 'long' ? exit - entry : entry - exit;
  return priceDiff * quantity - fees;
}

// ---------- Functie 3: trades filteren ----------
function filterTrades(list, { symbol = '', result = 'all' }) {
  return list.filter((t) => {
    const matchSymbol = t.symbol.includes(symbol.toUpperCase());
    const matchResult =
      result === 'all' ||
      (result === 'win' && t.pnl > 0) ||
      (result === 'loss' && t.pnl <= 0);
    return matchSymbol && matchResult;
  });
}

function deleteTrade(id) {
  trades = trades.filter((t) => t.id !== id);
  saveTrades();
  render();
}

// ---------- UI ----------
const form = document.getElementById('trade-form');
const list = document.getElementById('trade-list');
const emptyMsg = document.getElementById('empty-msg');
const filterSymbol = document.getElementById('filter-symbol');
const filterResult = document.getElementById('filter-result');

function formatMoney(value) {
  return (value < 0 ? '-€' : '€') + Math.abs(value).toFixed(2);
}

function renderStats() {
  const total = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;

  const pnlEl = document.getElementById('stat-pnl');
  pnlEl.textContent = formatMoney(total);
  pnlEl.className = 'text-lg font-bold ' + (total >= 0 ? 'text-emerald-400' : 'text-red-400');
  document.getElementById('stat-winrate').textContent = winRate + '%';
  document.getElementById('stat-count').textContent = trades.length;
}

function renderList() {
  const filtered = filterTrades(trades, {
    symbol: filterSymbol.value,
    result: filterResult.value,
  });

  list.innerHTML = '';
  emptyMsg.classList.toggle('hidden', filtered.length > 0);

  // Nieuwste trade bovenaan
  [...filtered].reverse().forEach((t) => {
    const li = document.createElement('li');
    li.className = 'bg-slate-800 rounded-lg p-3 flex justify-between items-center';
    li.innerHTML = `
      <div>
        <p class="font-semibold"></p>
        <p class="text-xs text-slate-400"></p>
      </div>
      <div class="text-right">
        <p class="font-bold ${t.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}">${formatMoney(t.pnl)}</p>
        <button class="text-xs text-slate-500 hover:text-red-400">Verwijder</button>
      </div>`;
    // textContent voorkomt dat gebruikersinvoer als HTML wordt uitgevoerd
    li.querySelector('.font-semibold').textContent = `${t.symbol} · ${t.side.toUpperCase()}`;
    li.querySelector('.text-xs').textContent =
      `${t.strategy} · ${t.entry} → ${t.exit} · ${new Date(t.date).toLocaleDateString('nl-NL')}`;
    li.querySelector('button').addEventListener('click', () => deleteTrade(t.id));
    list.appendChild(li);
  });
}

function render() {
  renderStats();
  renderList();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  logTrade(Object.fromEntries(new FormData(form)));
  form.reset();
  render();
});

filterSymbol.addEventListener('input', renderList);
filterResult.addEventListener('change', renderList);

render();
