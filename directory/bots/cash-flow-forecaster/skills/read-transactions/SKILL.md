---
name: read-transactions
description: Locate and read transaction files in the workspace.
---

1. List files in the workspace with `file_list`.
2. For each file that looks like transaction data (name contains transaction, statement, ledger, or ends in .csv/.xlsx/.json), read it with `file_read`.
3. Parse headers to find date, amount, description, category, and type (income/expense).
4. Return a summary of what was found: number of rows, date range, columns detected, and any issues (missing months, mixed formats).
5. If no suitable file is found, report that and ask the person for the file location or format.
