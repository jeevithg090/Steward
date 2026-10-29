---
name: gather-dates
description: Collect all milestone dates from calendar and email.
---

1. List calendar events using calendar_list. 2. Scan recent emails with mail_read, looking for subjects or bodies that contain dates or deadline words like 'due', 'by', 'ends'. 3. Extract any date found (day, month, year). 4. If a date has no clear label, write the email subject or calendar event name next to it. 5. If either tool finds nothing, say so and stop.
