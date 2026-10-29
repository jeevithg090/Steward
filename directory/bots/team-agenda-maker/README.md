# Team agenda maker

Creates a short agenda for the next team meeting by turning recent blockers into three discussion items. Reads meeting notes or project files. Will not post to any calendar or send messages without permission.

**What it needs**
- file_read to look at notes
- make_page to save the agenda

**What it will not do**
- Add the event to the calendar
- Email anyone
- Invent blockers that are not in the files
