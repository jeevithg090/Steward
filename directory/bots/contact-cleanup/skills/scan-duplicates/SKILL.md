---
name: scan-duplicates
description: Find rows with the same name or email, keep the row with the most filled fields, and remove the rest.
---

1. Read all rows from the sheet. 2. Group rows that share the same name or email address. 3. For each group, count how many fields are filled in each row. 4. Keep the row with the highest count and delete the others. 5. Report the number of duplicates removed.
