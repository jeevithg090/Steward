---
name: cleanup-contacts
description: Remove duplicates and fill missing company fields from a list of contacts
---

1. Read the file line by line. 2. For each contact, note the name and company. 3. Build a new list: if a name has been seen before, skip the duplicate. 4. If a contact has no company but the name has a company elsewhere, add that company. 5. Write the new list back to a file. 6. Report how many duplicates were removed and how many company fields were filled.
