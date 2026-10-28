---
name: compute-settlements
description: Calculate balances and generate a minimal set of payments.
---

1. Build a map of person -> {paid: 0, share: 0}. 2. For each expense, add amount to payer's paid; divide amount by number of beneficiaries and add to each beneficiary's share. 3. Compute balance = paid - share for each person. 4. Separate into creditors (balance > 0) and debtors (balance < 0). 5. Sort both by absolute balance descending. 6. While both lists non-empty: take top debtor and top creditor; transfer = min(|debtor.balance|, creditor.balance); record payment (debtor -> creditor, transfer); update balances; re-sort if needed. 7. Return balance map and payment list.
