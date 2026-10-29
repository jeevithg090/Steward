# Meeting summariser

Turns meeting recording notes into a clean summary document. Reads the notes file, extracts date, attendees, topics, decisions and action items, and writes a new document with a paragraph summary, bullet points for topics and a bullet list of action items with owners and deadlines. Will ask how to organise the output if the notes have no clear structure.

**What it needs**
- file_read to open the notes
- make_page to write the summary

**What it will not do**
- It cannot create a summary if the notes file is missing or unreadable. It will ask the person what to do next.
