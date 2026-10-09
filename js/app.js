// Opslag, validatie en de P&L-berekening (functie 2: calculatePnL) staan in trades.js,
// zodat de replay-pagina dezelfde code gebruikt.

// Trades worden opgeslagen in localStorage, zodat ze blijven na herladen
let trades = loadTrades();

function saveTrades() {
  if (!storeTrades(trades)) showError('Opslaan mislukt. Staat privé-browsen aan?');
}

// ---------- Functie 1: trade loggen ----------
function logTrade(data) {
  const trade = buildTrade(data);
  trades.push(trade);
  saveTrades();
  return trade;
}

// ---------- Functie 3: trades filteren ----------
function filterTrades(list, { symbol = '', strategy = 'all', result = 'all' }) {
  const search = symbol.trim().toUpperCase();
  return list.filter((t) => {
    const matchSymbol = t.symbol.includes(search);
    const matchStrategy = strategy === 'all' || t.strategy === strategy;
    const matchResult = result === 'all' || getResult(t.pnl) === result;
    return matchSymbol && matchStrategy && matchResult;
  });
}

// ---------- Statistieken ----------
function calculateStats(list) {
  const wins = list.filter((t) => t.pnl > 0);
  const losses = list.filter((t) => t.pnl < 0);
  const total = list.reduce((sum, t) => sum + t.pnl, 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  // Break-even trades tellen niet mee in de win rate
  const decided = wins.length + losses.length;

  return {
    count: list.length,
    total: Math.round(total * 100) / 100,
    winRate: decided ? Math.round((wins.length / decided) * 100) : 0,
    // Profit factor: totale winst gedeeld door totaal verlies (> 1 = winstgevend)
    profitFactor: grossLoss ? grossWin / grossLoss : null,
  };
}

function statsPerStrategy(list) {
  const groups = {};
  list.forEach((t) => {
    (groups[t.strategy] ||= []).push(t);
  });
  return Object.entries(groups)
    .map(([name, group]) => ({ name, ...calculateStats(group) }))
    .sort((a, b) => b.total - a.total);
}

function getStrategies() {
  return [...new Set(trades.map((t) => t.strategy))].sort((a, b) => a.localeCompare(b));
}

function deleteTrade(id) {
  trades = trades.filter((t) => t.id !== id);
  saveTrades();
  render();
}

// ---------- UI ----------
const form = document.getElementById('trade-form');
const formError = document.getElementById('form-error');
const list = document.getElementById('trade-list');
const emptyMsg = document.getElementById('empty-msg');
const filterSymbol = document.getElementById('filter-symbol');
const filterStrategy = document.getElementById('filter-strategy');
const filterResult = document.getElementById('filter-result');
const strategyTable = document.getElementById('strategy-table');
const strategySection = document.getElementById('strategy-section');
const strategyOptions = document.getElementById('strategy-options');
const itemTemplate = document.getElementById('trade-item');

const RESULT_COLORS = {
  win: 'text-emerald-400',
  loss: 'text-red-400',
  breakeven: 'text-slate-400',
};

function showError(message) {
  formError.textContent = message;
  formError.classList.toggle('hidden', !message);
}

// Huidige lokale tijd in het formaat van <input type="datetime-local">
function nowForInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function renderStats() {
  const stats = calculateStats(trades);
  const pnlEl = document.getElementById('stat-pnl');
  pnlEl.textContent = formatMoney(stats.total);
  pnlEl.className = 'text-lg font-bold ' + RESULT_COLORS[getResult(stats.total)];
  document.getElementById('stat-winrate').textContent = stats.winRate + '%';
  document.getElementById('stat-count').textContent = stats.count;
}

function renderStrategyOptions() {
  const strategies = getStrategies();
  const current = filterStrategy.value;

  filterStrategy.replaceChildren(new Option('Alle strategieën', 'all'));
  strategies.forEach((s) => filterStrategy.add(new Option(s, s)));
  // Behoud de keuze, tenzij die strategie niet meer bestaat
  filterStrategy.value = strategies.includes(current) ? current : 'all';

  // Suggesties bij het invullen van het formulier
  strategyOptions.replaceChildren(...strategies.map((s) => new Option(s)));
}

function renderStrategyTable() {
  const rows = statsPerStrategy(trades);
  strategySection.classList.toggle('hidden', rows.length === 0);

  strategyTable.replaceChildren(
    ...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t border-slate-800';
      const cells = [
        r.name,
        r.count,
        r.winRate + '%',
        r.profitFactor === null ? '–' : r.profitFactor.toFixed(2),
        formatMoney(r.total),
      ];
      cells.forEach((value, i) => {
        const td = document.createElement('td');
        td.className = i === 0 ? 'py-2 pr-2 break-all' : 'py-2 px-1 text-right whitespace-nowrap';
        if (i === cells.length - 1) td.className += ' font-semibold ' + RESULT_COLORS[getResult(r.total)];
        td.textContent = value;
        tr.appendChild(td);
      });
      return tr;
    })
  );
}

function renderList() {
  const filtered = filterTrades(trades, {
    symbol: filterSymbol.value,
    strategy: filterStrategy.value,
    result: filterResult.value,
  });

  emptyMsg.textContent = trades.length ? 'Geen trades gevonden met deze filters.' : 'Nog geen trades.';
  emptyMsg.classList.toggle('hidden', filtered.length > 0);

  // Nieuwste trade bovenaan
  const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

  list.replaceChildren(
    ...sorted.map((t) => {
      const li = itemTemplate.content.firstElementChild.cloneNode(true);
      const date = new Date(t.date).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
      // textContent voorkomt dat gebruikersinvoer als HTML wordt uitgevoerd
      li.querySelector('[data-role="title"]').textContent = `${t.symbol} · ${t.side.toUpperCase()}`;
      li.querySelector('[data-role="meta"]').textContent =
        `${t.source === 'replay' ? 'Replay · ' : ''}${t.strategy} · ${t.quantity} × ${t.entry} → ${t.exit}`;
      li.querySelector('[data-role="date"]').textContent = date;
      const pnlEl = li.querySelector('[data-role="pnl"]');
      pnlEl.textContent = formatMoney(t.pnl);
      pnlEl.classList.add(RESULT_COLORS[getResult(t.pnl)]);
      li.querySelector('[data-role="delete"]').addEventListener('click', () => {
        if (confirm(`Trade ${t.symbol} verwijderen?`)) deleteTrade(t.id);
      });
      return li;
    })
  );
}

function render() {
  renderStats();
  renderStrategyOptions();
  renderStrategyTable();
  renderList();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    logTrade(Object.fromEntries(new FormData(form)));
  } catch (err) {
    showError(err.message);
    return;
  }
  showError('');
  form.reset();
  form.elements.date.value = nowForInput();
  render();
});

filterSymbol.addEventListener('input', renderList);
filterStrategy.addEventListener('change', renderList);
filterResult.addEventListener('change', renderList);

// Is de replay in een ander tabblad open? Dan nieuwe trades daarvan direct tonen
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  trades = loadTrades();
  render();
});

form.elements.date.value = nowForInput();
render();
