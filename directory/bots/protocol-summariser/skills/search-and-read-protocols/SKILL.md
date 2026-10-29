---
name: search-and-read-protocols
description: Find and read protocol summaries from web results.
---

1. Use web_search to look for published study protocols on the topic. 2. For each result, use browser_navigate to open the page. 3. Use browser_snapshot to read the page content. 4. Look for the protocol section; if not found, note that and skip to the next result. 5. Extract the aim, methods, and key outcomes into one short paragraph. 6. Repeat for up to five results. 7. Use file_write to save all summaries to a text file in the workspace. 8. Use make_page to create a simple document with the summaries and show it to the person.
