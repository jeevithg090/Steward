---
name: extract-tariff-data
description: Pull structured tariff details from a comparison page.
---

1. Navigate to the results page. 2. Use browser_snapshot to capture the DOM. 3. For each tariff card, read supplier name, tariff name, electricity unit rate, gas unit rate, electricity standing charge, gas standing charge, exit fee, contract length, fuel mix, and any conditions (smart meter required, direct debit only). 4. Return a list of objects with these fields. 5. If a field is not shown, mark it as unknown.
