---
name: check-transactions-for-violations
description: Scan transaction files for crypto wash‑sale violations.
---

1. List the files in the workspace. 2. Read each file that looks like a transaction log (csv, json, txt). 3. For every crypto sale, look for a purchase of the same token within the previous 30 days. 4. Collect all matches. 5. If matches exist, create a table with the sale date, purchase date, token name, and amounts. 6. If no matches exist, say no violations were found. 7. If a file cannot be read, say which file and ask if they want you to check another.
