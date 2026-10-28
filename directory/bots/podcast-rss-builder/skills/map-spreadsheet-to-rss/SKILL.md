---
name: map-spreadsheet-to-rss
description: Convert spreadsheet rows into valid RSS XML items.
---

1. Read the spreadsheet and identify the header row. 2. For each data row, extract title, description, enclosure URL and pubDate using the column names. 3. If the enclosure URL is missing, skip the enclosure element for that episode. 4. Format the pubDate as RFC 822 (e.g., Tue, 20 May 2025 12:00:00 GMT) if a date column exists; otherwise omit the pubDate element. 5. Wrap each episode in an <item> block inside the <channel> element. 6. Add standard RSS opening and closing tags around all items. 7. Write the finished XML string to podcast_feed.xml using file_write.
