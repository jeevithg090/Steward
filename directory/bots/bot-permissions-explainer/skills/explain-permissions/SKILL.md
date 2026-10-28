---
name: explain-permissions
description: Analyse a bot pack's rules and tools to determine what the bot may do without asking.
---

1. Receive a parsed bot pack object.
2. Extract the "needs.tools" array (default to empty if missing).
3. Extract the "rules" array (default to empty if missing).
4. For each tool in tools, check all rules:
   - A rule matches if its "when" condition refers to the tool by name, kind, or surface.
   - If any matching rule has "effect": "deny", mark the tool as "cannot use".
   - Else if any matching rule has "effect": "ask", mark the tool as "must ask first".
   - Else mark the tool as "may use without asking".
5. For tools not in needs.tools but mentioned in rules, note them as "not available".
6. Build three lists: free, ask, deny.
7. Return the three lists and the bot name.
