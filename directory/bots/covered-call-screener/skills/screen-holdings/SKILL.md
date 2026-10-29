---
name: screen-holdings
description: Find covered call candidates in the person's portfolio.
---

1. Ask the person for their stock tickers, or check if their portfolio is accessible. 2. For each ticker, use browser_navigate to go to a financial data site. 3. Search for the ticker and locate the options chain or covered call section. 4. Record the last price, the nearest expiry, and the call strike prices with their premiums. 5. Calculate the yield as premium divided by stock price. 6. Flag candidates with a yield above 1% per month. 7. Build a table with ticker, shares, stock price, strike, premium, and yield. 8. Show the table sorted by yield highest first. 9. If data is missing, note it in the table and continue to the next ticker.
