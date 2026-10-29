---
name: scan-pantry-for-sugary-items
description: "List the person's pantry items. For each item, web_search for its added‑sugar content per 100 g or per serving. Keep the search results short: product name, brand, and sugar grams. If the search returns no result, note that the sugar amount could not be found."
---

1. Ask the person to list the items they want to check, or read their pantry file if it exists. 2. For each item, run web_search with the query "<item> added sugar per 100g". 3. From the results, extract the sugar grams per 100 g or per serving. 4. If a result has no sugar figure, write "sugar amount not found" next to that item. 5. Stop after you have checked the items the person listed.
