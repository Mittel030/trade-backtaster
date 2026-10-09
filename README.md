# Trade Backtester

Mobielvriendelijke webapp om day-trading strategieën te backtesten.
Gemaakt met HTML, Tailwind CSS en JavaScript.

## Functies
1. **Trades loggen** – `logTrade()`
2. **P&L berekenen** – `calculatePnL()` (long en short, inclusief kosten)
3. **Filterbare trade-geschiedenis** – `filterTrades()` (op symbool, strategie en winst/verlies/break-even)

Extra:
- Invoercontrole met duidelijke foutmeldingen (`validateTrade()`)
- Datum en tijd van de trade zelf instellen
- Statistieken per strategie: aantal trades, win rate, profit factor en P&L (`statsPerStrategy()`)

Trades worden opgeslagen in `localStorage` van de browser.

## Replay (backtesten op oude marktdata)
Op `replay.html` speel je oude koersdata candle voor candle af, net als bij FX Replay:

1. Kies een markt:
   - **MNQ** (Micro Nasdaq-100, $2 per punt) of **MES** (Micro S&P 500, $5 per punt).
     Data komt gratis van Yahoo Finance. Hoe ver je terug kunt hangt af van de timeframe:
     1m = 30 dagen, 5m/15m/30m = 60 dagen, 1h = 2 jaar, 1d = sinds 2019.
   - **Eigen CSV-bestand** – voor oudere data of andere markten. Kolommen: tijd, open, high, low, close.
     Werkt met exports van o.a. Yahoo Finance, Dukascopy en MetaTrader. Noem je de markt `MNQ` of `MES`,
     dan rekent de app automatisch met de juiste dollar-per-punt.
2. Kies een startmoment. Je ziet alleen de candles vóór dat moment, de toekomst blijft verborgen.
3. Speel af met **▶ Afspelen** of stap per candle met **⏭ +1** (op de laptop: spatie en pijl rechts).
4. Open een **Buy** of **Sell** met optionele stop-loss en take-profit. Raakt een candle beide,
   dan rekent de app met de stop-loss (slechtste geval).
5. Gesloten trades komen automatisch in het journaal, gemarkeerd als "Replay".

Bestanden:
- `js/trades.js` – gedeelde code: opslag, validatie, `calculatePnL()` en de contractgegevens van MNQ/MES
- `nginx.conf` – proxy `/api/yahoo/` naar Yahoo Finance. Yahoo blokkeert verzoeken direct vanuit
  de browser (CORS), dus de replay werkt alleen via de Docker-container.
- `js/app.js` – het journaal (`index.html`)
- `js/replay.js` – de replay (`replay.html`), grafiek via [Lightweight Charts](https://tradingview.github.io/lightweight-charts/)

## Starten met Docker
```bash
cd C:\Docker\trade-backtester
docker compose up -d
```
Open daarna http://localhost:8090

Stoppen: `docker compose down`

## Testen op je telefoon
1. Zorg dat je telefoon en laptop op hetzelfde wifi-netwerk zitten.
2. Zoek het IP-adres van je laptop op (`ipconfig` → IPv4-adres, bv. `192.168.1.20`).
3. Open op je telefoon `http://192.168.1.20:8090`.
4. Werkt het niet? Sta poort 8090 toe in de Windows Firewall.

## Leerdoel
Uiterlijk 30 oktober 2026 de app zonder fouten werkend op mijn telefoon demonstreren.
