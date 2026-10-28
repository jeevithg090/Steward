---
name: map-tools-to-triggers
description: Match each tool or connector to the exact rule trigger values.
---

1. List every tool in needs.tools.
2. For each tool, check the reference list of allowed `when` values.
3. If the tool matches a trigger (e.g. mail_send → tool.kind == "send"), note that trigger.
4. Also scan instructions for verbs like "click", "type", "run", "delete", "pay", "sign" that map to browser write, shell, delete, pay, sign triggers.
5. Return the set of unique triggers found.
