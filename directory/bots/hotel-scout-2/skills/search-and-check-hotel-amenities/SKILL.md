---
name: search-and-check-hotel-amenities
description: Find hotels near the train station and verify bike storage and charging point.
---

1. Use web_search to look for hotels near the named train station. 2. Browse the search results with browser_navigate. 3. For each listing, use browser_snapshot to read the page and look for the words 'bike storage' or 'charging point'. 4. If a listing mentions both, note the hotel name, address, and how far it is from the station. 5. If no listing clearly has both, open a few pages and scroll with browser_scroll to find the amenities section. 6. When the search is complete, show the person the best matches found, or say that no hotel was found with both features and suggest changing the search.
