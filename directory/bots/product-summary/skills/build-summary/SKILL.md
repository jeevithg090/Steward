---
name: build-summary
description: Make a one-page product summary for sales reps.
---

1. Read the person's product notes from their workspace using file_read. If the file is not there, ask the person for the text or a link and stop. 2. Open a browser tab and go to the product's public website or docs using browser_navigate. 3. Use browser_snapshot to read the page. If the page has a clear description, copy the key points. If not, use web_search to find the product and read those results. 4. Collect the product name, what it does, who it is for, and one unique fact. 5. Close extra tabs with browser_back. 6. Open make_page and write a short intro, a bullet list of main features, a sentence on the target user, and a sentence on the sales value. 7. Save the page as 'product-summary.md' using file_write. 8. Show the finished page to the person and ask if they want to keep it or change anything.
