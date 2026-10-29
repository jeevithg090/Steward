---
name: find-cd-rates
description: search and read web pages for cd rates and penalties
---

1. Use web_search with the query "five year cd ladder one hundred thousand dollars" and note the URLs that look like bank or credit union offerings. 2. For each selected URL, use browser_navigate to open the page. 3. Use browser_snapshot to read the page and locate the annual percentage yield and the early withdrawal penalty. 4. If the penalty is given in months of interest, record that number. 5. If the page does not show a penalty, record that it was not found. 6. Repeat for up to three banks. 7. When all pages are read, use show_comparison to display the bank, rate, and penalty side by side. 8. Use make_page to create a document that lists each bank, its rate, and its withdrawal penalty. If any step finds nothing, note that clearly and continue with the next bank.
