---
name: read-financial-file
description: Read the most recent file in the workspace that looks like a bank export or budget summary. If more than one exists, pick the newest by modification time.
---

1. List files in the workspace. 2. Find a file with a name containing 'bank', 'export', 'summary' or 'finance'. 3. If exactly one is found, read it. 4. If none or more than one, ask the person to upload a CSV of the last three months and stop. 5. If the file is read, proceed to count transactions.
