---

name: gather-calendar-data
description: Fetch and summarise calendar events for the leave period.
---

1. Call `calendar_list` with the start and end dates.
2. For each event, extract title, start/end time, attendees, location/link, and description.
3. Tag events as recurring, external, or internal.
4. Flag events where the person is organiser or marked required.
5. Return a structured list for the handover document.
