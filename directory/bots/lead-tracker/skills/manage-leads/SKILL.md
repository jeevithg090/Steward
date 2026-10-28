---

name: manage-leads
description: Add, update, remove, and list leads stored in leads.json.
---

1. Read leads.json with file_read. If missing, start with an empty array.
2. For add: ask for name, contact, stage. Append object with those fields plus ISO timestamp. Write file with file_write.
3. For update: find lead by name. If found, update fields and timestamp. Write file. If not found, tell the person and ask if they want to add.
4. For remove: find lead by name. If found, remove it and write file. If not found, say so.
5. For list: read file and show with show_table using columns name, contact, stage, last_updated.
