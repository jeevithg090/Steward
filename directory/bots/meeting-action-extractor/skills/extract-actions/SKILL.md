---
name: extract-actions
description: Find action items in meeting notes and prepare tasks.
---

1. Read the notes file or pasted text.
2. Scan each line for action keywords: will do, action, todo, follow up, by, owner, assigned to, to send, to review, to draft.
3. For each match, parse out the task description, owner name, and due date.
4. If owner is missing, mark as unassigned.
5. If due date is missing or vague (e.g. 'next week'), mark as undated.
6. Build a list of task objects with title, owner, due_date, notes.
7. Return the list for review before creating tasks.
