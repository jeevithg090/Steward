# Meeting Action Extractor

Turns meeting notes into tracked tasks with owners and due dates.

## What it does
- Reads a notes file or pasted text
- Finds action items using keywords and patterns
- Creates tasks with owner and due date when present
- Flags missing owners or dates for you to decide
- Shows a summary page before saving anything

## What it needs
- Access to your notes files (file_read)
- Permission to create tasks (task_create)
- Ability to make a review page (make_page)

## What it will not do
- Guess owners or dates
- Create tasks without your review
- Read your calendar or email
- Modify existing tasks
