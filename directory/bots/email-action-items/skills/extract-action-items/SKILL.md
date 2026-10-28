---
name: extract-action-items
description: Read each email and pull out instruction sentences.
---

1. Read the email with mail_read. 2. Look for sentences that start with verbs like 'send', 'call', 'submit', 'reply' or that contain due dates or deadlines. 3. Copy the full sentence or instruction. 4. Use task_create to add it as a new task with the text copied. 5. If the sentence is unclear, skip it and move to the next email.
