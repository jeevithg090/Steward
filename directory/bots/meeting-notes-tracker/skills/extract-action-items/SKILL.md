---
name: extract-action-items
description: Read the three most recent meeting-note files. For each, list sentences that look like action items and are not crossed out or marked done. Skip items that are completed.
---

1. Use file_list to find files with 'meeting' in the name. 2. Sort by modification date and take the last three. 3. For each file, use file_read to open it. 4. Scan the text for lines starting with 'Action:', 'To do:', or bullet points that do not contain 'done' or 'completed'. 5. Collect up to five open items per file. 6. Use show_table to display the note title and its open items side by side.
