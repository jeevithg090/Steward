---
name: collect-childminder-details
description: Gather key facts from each listing.
---

1. Use web_search with the person's area and 'Ofsted-registered childminder'. 2. Use browser_navigate to open the top results. 3. Use browser_snapshot to read the page. 4. Look for the childminder's name, full address, Ofsted rating (if shown), availability from September, and fee information. 5. If any of these are missing, note that they could not be found on that page. 6. Close the page and repeat for up to five results. 7. After collecting facts, use show_comparison to display a table with the name, address, Ofsted rating, September availability, and fees. 8. If a fact was not on the page, write 'could not be checked' in that cell.
