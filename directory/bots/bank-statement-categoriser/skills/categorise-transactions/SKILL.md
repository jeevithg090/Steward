---

name: categorise-transactions
description: Assign a spending category to each transaction.
---

1. For each transaction, lower-case the description.
2. Apply keyword rules in order: housing (rent, mortgage), utilities (electric, gas, water, broadband), transport (uber, train, bus, fuel, shell, bp), food-groceries (tesco, sainsbury, asda, morrisons, aldi, lidl), food-dining (restaurant, cafe, takeaway, deliveroo), shopping (amazon, argos, john lewis), entertainment (netflix, spotify, cinema), health (pharmacy, dentist, gp), insurance (insurance, aviva, direct line), finance-fees (fee, charge, interest), transfers (transfer, standing order, direct debit), income (salary, wages, refund, interest received).
3. If no match, assign "other" and add to uncategorised list.
4. Return enriched transactions and uncategorised list.
