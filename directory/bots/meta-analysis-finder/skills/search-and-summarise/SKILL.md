---
name: search-and-summarise
description: Find and summarise meta-analyses on a given topic.
---

1. Use web_search with the topic and 'meta-analysis' and limit results to the last five years. 2. For each result, use browser_snapshot to open the page. 3. Check if the page is a meta-analysis; if not, close and try the next result. 4. If the page is accessible, extract the title, year, journal, and key findings. 5. Write each study's summary as a single line of text: title (year) — main result. 6. Save all summaries to a text file using file_write. 7. Use show_table to display the file contents.
