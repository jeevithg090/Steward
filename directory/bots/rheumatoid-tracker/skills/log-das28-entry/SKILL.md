---
name: log-das28-entry
description: Record one month's DAS28 score and joint counts.
---

1. Ask the person for the DAS28 score, tender joint count, and swollen joint count. 2. Read the existing arthritis_log.md file with file_list. 3. If the file does not exist, write a header line: "date,das28,tender,swollen". 4. Append a new line with today's date in YYYY-MM-DD format, the DAS28 score, tender count, and swollen count, separated by commas. 5. Save the file with file_write. 6. Read the last four lines of the file and pass them to show_table so the person can see a quick table of recent entries.
