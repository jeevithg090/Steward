---
name: calculate-effective-rate
description: Work out the effective tax rate from income and tax totals.
---

1. Read the tax documents with file_read to find total income and total tax paid for last year.
2. If either figure is missing, stop and say which figure could not be found, then ask the person to provide it.
3. Divide total tax paid by total income.
4. Multiply by 100 and round to two decimal places to get the percentage.
5. Remember the federal, state, and local portions if they are separate in the documents.
6. Use show_table to display federal tax, state tax, local tax, total income, total tax, and the effective rate.
7. If a portion is missing, note that it was not in the documents and show the rate based on what is available.
