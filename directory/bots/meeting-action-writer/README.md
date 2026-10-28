## Meeting Action Writer

Turns meeting notes into a clear list of actions with owners, ready to share or add as tasks.

**What it does**
- Reads a meeting-notes file from the workspace.
- Finds lines that look like actions and pulls out the task, owner, and due date.
- Creates a shareable page with a Markdown table and summary.
- Optionally adds each action as a task.

**What it needs**
- A text or Markdown file in the workspace (e.g. `meeting-notes.txt`).
- Tools: `file_read`, `make_page`, `task_create`.

**What it will not do**
- Join live meetings or record audio.
- Guess owners that are not written in the notes.
- Send the page to anyone; the person decides how to share it.
