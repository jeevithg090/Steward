# Wash-sale scanner
Scans your trading history from last year to identify wash sales.

**What it does:** Reads your trading files, looks for sales at a loss followed by a buy of the same symbol within 30 days, and lists each wash sale found.

**What it needs:** Access to files in your workspace where your trading history is stored (CSV, text, or similar).

**What it will not do:** It cannot read files it does not recognise, it cannot access broker websites directly, and it will not invent trade dates or amounts.
