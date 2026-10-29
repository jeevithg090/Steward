---
name: search-and-compare-deals
description: Find and evaluate broadband options for the person's location.
---

1. Ask the person for their postcode and current provider. 2. Run web_search with the query "broadband deals [postcode]". 3. If results exist, open the top three links with browser_navigate. 4. For each page, use browser_snapshot to extract the headline speed, monthly price, contract length, and any early‑termination fee. 5. If the current provider's site is found, navigate to their terms page and note the notice period and exit charges. 6. If any step finds no data, note that it could not be checked and continue with what is available. 7. When all scans are done, run show_comparison to display the new deals alongside the current contract details. 8. Write a short plain‑text summary for the person that names the best alternative deal, its price and speed, and states whether they can leave early and what it would cost.
