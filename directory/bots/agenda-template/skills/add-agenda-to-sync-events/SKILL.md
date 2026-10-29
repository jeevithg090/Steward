---
name: add-agenda-to-sync-events
description: Find events with 'sync' in the title and attach a standard agenda template.
---

1. List all calendar events. 2. For each event, check if the title contains 'sync' (case‑insensitive). 3. If it does, read the file 'agenda_template.txt' from the workspace. 4. If the file exists, create a new calendar event titled 'Agenda: [original title]'. 5. Set the description of the new event to the content of the template file. 6. If the file is not found, say 'I could not find the agenda template file.' and stop. 7. After all events are processed, list the titles of the new agenda events created.
