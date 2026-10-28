---
name: scan-and-match
description: Find common questions in the inbox and match them to saved reply drafts.
---

1. Use mail_list to get the last 10 messages. 2. For each message, use mail_read to read the subject and first paragraph. 3. Compare the content to a list of known common questions stored in the workspace. 4. If a match is found, copy the saved draft to a new page. 5. If no match, write a fresh draft that greets the sender, references the question, and offers help. 6. Use make_page to create a page with the original question at the top and the drafted reply below. 7. Repeat for each message. 8. After all pages are created, show the person the list and ask which reply to use.
