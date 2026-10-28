---
name: search-for-hotels
description: Find hotels with a pool near a station within a budget.
---

1. Use web_search with the query "hotel with pool near [station]" and the budget included in the search terms. 2. If the search returns many results, use browser_navigate to open the top few links. 3. Use browser_snapshot to read each page and look for the words "pool" and a price. 4. If a page does not show a price or a pool, use browser_back to go back to the search results. 5. Collect up to three listings that have a pool and a price within the budget, and note the distance to the station if mentioned. 6. If fewer than three are found, say how many were found and ask if the person wants to broaden the search.
