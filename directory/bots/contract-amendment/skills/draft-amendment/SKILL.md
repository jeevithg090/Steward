---
name: draft-amendment
description: Write a contract amendment from email discussion.
---

1. Read the most recent email thread about the contract discussion using mail_list or web_fetch. 2. If no email exists, tell the person and ask if they have notes or a draft. 3. Open a new page with make_page. 4. Write the amendment text that restates only the points the person agreed last week. 5. Do not add new terms or change obligations. 6. Show the draft to the person and ask if they want to send it. 7. If yes, use mail_send to send it to the other party's email address, which the person must provide. 8. After sending, save a copy of the draft using file_write.
