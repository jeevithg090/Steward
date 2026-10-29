---
name: gather-factor-data
description: For each ticker in the portfolio, search the web for market cap, P/E ratio, six-month price return, and return on equity. Record the value and the portfolio weight. If a search returns no result, mark it as unavailable and move to the next ticker.
---

1. Read the portfolio file and list all tickers and their weights. 2. For each ticker, open a web search for 'ticker market cap'. Note the market cap value. 3. Open a web search for 'ticker P/E ratio'. Note the P/E value. 4. Open a web search for 'ticker six month return'. Note the return percentage. 5. Open a web search for 'ticker return on equity'. Note the ROE percentage. 6. If any search returns no result, write 'unavailable' for that metric. 7. Continue until all tickers have been checked.
