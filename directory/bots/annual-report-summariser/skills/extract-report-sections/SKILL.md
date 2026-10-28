---
name: extract-report-sections
description: Pull the useful sections from an annual report PDF or HTML.
---

1. Load the report via web_fetch or file_read.
2. Search the text for headings containing: chair, chief executive, CEO, strategic report, business model, financial highlights, key performance indicators, principal risks, risk factors, outlook, strategy, segment, division.
3. Copy the paragraphs under those headings, up to the next major heading or 2,000 characters each.
4. Note the reporting period (year ended date) from the front cover or financial statements.
5. Return the collected sections as plain text for the summariser.
