---

name: gather-mail-threads
description: Fetch and summarise action-required email threads from the last 14 days.
---

1. Call `mail_list` for the last 14 days.
2. Filter threads with unread, flagged, or keywords: action, urgent, deadline, approval, review, handover, cover, blocker.
3. For each thread, note subject, participants, last message date, and a one-line summary of what is needed.
4. Return a structured list for the handover document.
