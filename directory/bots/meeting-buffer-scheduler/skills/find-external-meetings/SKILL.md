---
name: find-external-meetings
description: Look through the next 14 days of calendar events. For each event, check if the title or description mentions a video conference link or the word "External". If it does, note the event's end time. If the event ends and the next free slot is at least 15 minutes later, prepare a 15-minute block starting right after. If the event is titled "Internal" or has no conference link, skip it and move to the next event. When finished, show the list of events you looked at and the blocks you prepared for the person to review.
---

1. Call calendar_list for the next 14 days. 2. For each event: check title/description for conference link or "External". 3. If found, note end time. 4. If end time exists and next slot is >=15 min, prepare block. 5. Skip internal events or those without links. 6. Present summary to the person.
