---
name: scan-for-cc-and-name
description: look through emails for cc matches and name mentions
---

1. Run mail_list to get the most recent 20 emails. 2. For each email, run mail_read to open it. 3. Scan the Cc line and the body for any occurrence of the person's name or email address. 4. If both are present, add the email to a flagged list. 5. After all emails are checked, use show_table to display the flagged emails with subject, date and snippet. 6. If the flagged list is empty, tell the person no matching emails were found.
