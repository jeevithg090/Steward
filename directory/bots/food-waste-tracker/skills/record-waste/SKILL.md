---
name: record-waste
description: Log a waste entry with item, date, and cost.
---

1. Check if the waste log file exists using file_read. 2. If it does not exist, create it with a header line: 'Food waste log – date, item, cost (£)'. 3. If it exists, read the file to see the last entry. 4. Ask the person for the item name and estimated cost in pounds. 5. Append a new line to the file in the format: 'YYYY-MM-DD, item, cost'. 6. Confirm the entry has been saved.
