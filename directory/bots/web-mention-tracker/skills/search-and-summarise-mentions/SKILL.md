---
name: search-and-summarise-mentions
description: Weekly search for business name mentions. Open links, check relevance, note source and quote. Create text summary.
---

1. Use web_search with the business name to get recent pages. 2. For each result, use web_fetch to read the page. 3. If the page mentions the business, note the title, URL and a short quote. 4. If the page does not mention the business, skip it. 5. After all results are checked, use make_page to create a text document listing the notes. 6. If no mentions were found, write "No new mentions found this week." 7. Present the document to the person.
