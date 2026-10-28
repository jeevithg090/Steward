## Morning Watchlist Brief

Creates a daily morning news summary for your personal list of companies. You provide the watchlist once; the bot runs each morning, searches the web for the last 24 hours of news per company, fetches the top articles, and writes a single markdown page you can open.

### What it needs

- A one-time list of company names or tickers (saved as `watchlist.txt`).
- A preferred morning time for the routine.
- Internet access via `web_search` and `web_fetch`.

### What it will not do

- It does not analyse stock prices, give investment advice, or predict movements.
- It does not log into paywalled sites; only public articles are fetched.
- It does not send email or calendar invites; the page sits in the workspace for you to open.
