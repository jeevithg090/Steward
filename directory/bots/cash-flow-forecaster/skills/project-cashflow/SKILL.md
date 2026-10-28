---
name: project-cashflow
description: Calculate monthly totals and project six months forward.
---

1. From the parsed transactions, group by calendar month (YYYY-MM).
2. For each month, sum amounts where type is income and where type is expense.
3. Compute net cash flow per month.
4. Determine the baseline: average monthly income and average monthly expenses over the last 3-6 months with data.
5. For each of the next six months, set projected income = baseline income, projected expenses = baseline expenses.
6. Adjust any month where the person has flagged a known change (e.g., tax payment, bonus, large purchase).
7. Calculate running balance starting from the current balance if known, otherwise from zero with a clear note.
8. Return the forecast as an array of objects ready for `show_table`.
