---

name: fallback-manual-triage
description: Manually sort messages when triage_inbox is not available.
---

1. Get the message list with mail_list. 2. For each message, read it with mail_read. 3. Check the date: keep messages from the last 48 hours. 4. Check the subject and snippet for words like urgent, deadline, today, action required, reply needed. 5. Put matches into "needs you", the rest into "can wait". 6. Return both lists with subject, sender, date and a one-line summary.
