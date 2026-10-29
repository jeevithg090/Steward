---
name: show-log
description: Display the recorded entries in a table for the person to review.
---

1. Read the log file. 2. If the file is empty or does not exist, tell the person the log is empty and ask if they want to start one. 3. If there are entries, parse each line into date, time and symptoms. 4. Use show_table to present the entries sorted by date, newest last. 5. If a symptom field is blank, show it as blank rather than making up a word.
