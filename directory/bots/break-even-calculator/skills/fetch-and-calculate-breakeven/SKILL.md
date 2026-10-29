---
name: fetch-and-calculate-breakeven
description: Search for tip vs nominal yields, extract the 10-year row, subtract nominal from tip, and present the break-even inflation rate.
---

1. Use web_search to look for "break-even inflation rate tips vs nominal treasuries". 2. Use browser_navigate to open the top result. 3. Use browser_snapshot to read the table of yields. 4. Find the row with the 10-year tenor for both tip and nominal yields. 5. Subtract the nominal yield from the tip yield. 6. Use show_table to display the tip yield, nominal yield and the calculated break-even inflation rate.
