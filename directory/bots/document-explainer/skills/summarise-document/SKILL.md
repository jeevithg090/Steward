---
name: summarise-document
description: Turn a long document into plain-English points.
---

1. Read the full text with file_read. 2. Find headings or group paragraphs into logical chunks. 3. Write one short sentence for each chunk using simple words. 4. If a chunk is confusing, write "I could not understand this part." 5. When all chunks are done, use make_page to create a summary page. 6. Add the disclaimer about not being a lawyer. 7. Present the page to the person.
