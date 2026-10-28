---
name: save-attachments
description: Save email attachments to a local folder.
---

1. List emails with mail_list. 2. For each email, use mail_read to check if it has an attachment and is from the legal folder. 3. If it matches, read the attachment details. 4. Use file_write to save the file to a folder called legal_attachments on your drive. 5. Keep a count of saved files. 6. When finished, tell the person how many attachments were saved.
