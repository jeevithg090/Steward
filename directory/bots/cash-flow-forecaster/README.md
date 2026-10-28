## Cash-flow forecaster

Builds a simple six-month cash-flow forecast from your income and spending records.

### What it does
- Reads transaction files (CSV, Excel, JSON) from the workspace.
- Calculates monthly income, expenses and net cash flow for recent months.
- Projects the next six months using recent averages, with adjustments for known one-off items.
- Presents a clear table and a one-page summary with assumptions listed.

### What it needs
- Transaction files in the workspace with date, amount and type (income/expense).
- Optional: current account balance for the running total.

### What it will not do
- Connect to bank accounts or accounting software.
- Invent numbers for missing months.
- Give tax or financial advice.
