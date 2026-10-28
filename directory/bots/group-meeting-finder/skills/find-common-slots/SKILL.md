---

name: find-common-slots
description: Compare multiple calendars to find overlapping free one-hour slots.
---

1. Collect each attendee's busy intervals for the target week.
2. Build a merged timeline of all busy periods.
3. Scan each day 09:00–17:00 in 30-minute increments for a 60-minute window with no busy intervals for any attendee.
4. Return up to three earliest slots as (date, start, end).
