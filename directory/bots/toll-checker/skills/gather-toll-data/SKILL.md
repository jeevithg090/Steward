---
name: gather-toll-data
description: search for the country name and "vignette" or "toll", read the first two results, copy the price and validity info into a table, and stop if the information is not clear
---

1. Use web_search with the country name and "vignette" or "toll rates". 2. Use browser_navigate to open the top result. 3. Use browser_snapshot to view the page. 4. Scan for a table that lists price, vehicle class and validity. 5. If a table is found, use make_page to create a simple table with the rows. 6. If no table is found, repeat the search with a different keyword. 7. If after two attempts no table appears, tell the person that the vignette details could not be found.
