## Portfolio Rebalancer

Calculates the trades needed to bring your portfolio back to its target asset allocation. Reads your current holdings and target weights from files in the workspace, then shows you exactly what to buy and sell.

### What it does
- Reads holdings (symbol, quantity, price, asset class) and targets (asset class, target weight) from CSV or JSON files.
- Validates data and flags missing or inconsistent entries.
- Computes current allocation, target allocation, and the difference per asset class.
- Proposes trades per holding (proportional within each asset class).
- Presents three views: allocation summary, side-by-side comparison, and detailed trade list.

### What it needs
- A holdings file in the workspace (CSV/JSON).
- A targets file in the workspace (CSV/JSON).
- No external connectors or API keys.

### What it will not do
- Place trades or connect to a broker.
- Fetch live prices (uses the prices in your holdings file).
- Optimise for tax, transaction costs, or lot-size constraints beyond simple rounding.
- Give financial advice; it only shows the arithmetic.
