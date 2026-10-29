# factor exposure
Analyze the value, momentum, quality and size factors in a stock portfolio.

What it does: reads a holdings file, looks up market data for each ticker, and calculates weighted factor exposures.

What it needs: a portfolio file in CSV or JSON with ticker symbols and weights; web access to look up financial metrics.

What it will not do: it cannot analyze a portfolio without a file, and it will not invent financial data when a metric is unavailable.
