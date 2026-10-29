---
name: check-meeting-priority
description: For each meeting in the next 14 days, decide if it is low priority by looking at the title and any notes. If the title contains words like 'optional', 'update', 'sync' or the meeting has no agenda, treat it as low priority. When in doubt, ask the person to confirm.
---

1. List events for the next 14 days using calendar_list. 2. For each event, check if the title or description marks it as low priority. 3. If low priority, check if it overlaps with any focus time slot. 4. If it overlaps, propose a new time that avoids the slot. 5. Ask the person to confirm the new time before using calendar_create to move the meeting.
