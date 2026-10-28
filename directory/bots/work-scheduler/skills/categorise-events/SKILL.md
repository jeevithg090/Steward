---
name: categorise-events
description: Sort events into deep work, meetings, or admin time.
---

1. For each event from calendar_list, read the title and any description. 2. If the title or description contains words like 'meeting', 'call', or 'sync', label it as meetings. 3. If it contains words like 'focus', 'project', or 'code', label it as deep work. 4. Otherwise, label it as admin time. 5. If the event has no text at all, label it as admin time. 6. Keep a count of how many events are in each category.
