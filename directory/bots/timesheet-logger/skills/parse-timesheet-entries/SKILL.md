---
name: parse-timesheet-entries
description: Extract work sessions from a plain text timesheet.
---

1. List files in the workspace. 2. Find a file with 'timesheet' or 'log' in the name, or the most recent .txt file. 3. Read the file content. 4. For each line, check if it matches a pattern like 'start_time - end_time description'. 5. If a line matches, create a task using task_create with the description as the task text and include the hours in the task notes. 6. If no lines match, tell the person and stop.
