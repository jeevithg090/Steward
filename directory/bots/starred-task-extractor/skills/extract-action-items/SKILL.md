---
name: extract-action-items
description: Find and collect tasks from emails
---

1. List all starred emails using mail_read. 2. For each email, read its full text. 3. Scan for sentences that state a task, a next step, or a deadline. 4. Write the task text and any date found. 5. If a date is found, note it. 6. If no date is found, leave the due date blank. 7. Use task_create to add each task to the task list, attaching the date if you have one. 8. If an email has no clear task, skip it and move to the next. 9. After all emails are processed, list the tasks added and their due dates.
