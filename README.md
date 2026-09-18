# Trade Backtester

Mobielvriendelijke webapp om day-trading strategieën te backtesten.
Gemaakt met HTML, Tailwind CSS en JavaScript.

## Functies
1. **Trades loggen** – `logTrade()`
2. **P&L berekenen** – `calculatePnL()` (long en short, inclusief kosten)
3. **Filterbare trade-geschiedenis** – `filterTrades()` (op symbool en winst/verlies)

Trades worden opgeslagen in `localStorage` van de browser.

## Starten met Docker
```bash
docker compose up --build
```
Open daarna http://localhost:8080

## Testen op je telefoon
1. Zorg dat je telefoon en laptop op hetzelfde wifi-netwerk zitten.
2. Zoek het IP-adres van je laptop op (`ipconfig` → IPv4-adres, bv. `192.168.1.20`).
3. Open op je telefoon `http://192.168.1.20:8080`.
4. Werkt het niet? Sta poort 8080 toe in de Windows Firewall.

## Leerdoel
Uiterlijk 30 oktober 2026 de app zonder fouten werkend op mijn telefoon demonstreren.
