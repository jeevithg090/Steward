---
name: build-calendar-page
description: Create a new page titled 'Video Content Calendar'. Add each video topic as a heading. For every topic, find the next available date on the calendar, create a filming event, then create a publish event seven days later. If a date is already taken, move to the next free day. After all topics are entered, display the calendar table so the person can review the full schedule.
---

1. Use make_page to create a blank page named 'Video Content Calendar'. 2. Ask the person for a list of video topics, one by one. 3. For each topic, run calendar_list to see existing events. 4. Pick the first free day after today. 5. Use calendar_create to add a filming event on that day. 6. Use calendar_create to add a publish event eight days after the filming date. 7. Repeat for each topic. 8. Show the completed calendar on the page and ask if they want to change any dates.
