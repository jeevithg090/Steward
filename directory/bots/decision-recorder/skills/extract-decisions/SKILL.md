---
name: extract-decisions
description: Find decisions, actions, and open questions in a list of email messages.
---

1. Sort messages by date ascending.
2. For each message, look for decision keywords: agreed, decided, approved, will do, going with, chosen, selected, confirmed.
3. Capture the sentence containing the keyword, the sender, and the date.
4. Look for action patterns: "@name", "assigned to", "owner:", "due by", "by Friday".
5. Capture task text, owner, due date.
6. Collect questions ending with "?" that have no reply answering them.
7. Return structured lists for decisions, actions, open questions.
