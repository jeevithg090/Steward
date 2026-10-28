---
name: gather-receipts
description: Find and read all receipt or ticket files in the workspace.
---

1. Use file_list to see what files are present. 2. For each file that looks like a receipt (contains words like receipt, ticket, fare), open it with file_read. 3. Extract the date, vendor name and amount. 4. If a date is unclear, note the filename and continue. 5. Stop when all receipt files have been read.
