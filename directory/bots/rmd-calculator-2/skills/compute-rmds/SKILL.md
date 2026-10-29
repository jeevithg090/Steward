---
name: compute-rmds
description: Calculate required minimum distributions from account data.
---

1. Use file_read to open the account list or ask the person for balances and ages.
2. For each account, find the current balance and the person's age as of 31 December.
3. Look up the Uniform Lifetime Table factor for that age.
4. Multiply balance by the factor to get the individual RMD.
5. Add all individual RMDs to get the total aggregated withdrawal.
6. If a balance or age is missing, note it and ask the person to provide the missing item.
7. When all data is present, use show_table to list each account's balance, age factor, and RMD, plus the total.
8. Use make_page to produce a document with the table and the total RMD clearly stated.
