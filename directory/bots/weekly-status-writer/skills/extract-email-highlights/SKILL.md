---
name: extract-email-highlights
description: Filters and summarises relevant work emails from the past week.
---

1. Call `mail_list` with a 7-day window.
2. For each thread, read full content via `mail_read` if needed.
3. Discard automated mail (security alerts, newsletters, CI/CD bots).
4. Collect: decisions, shipped features, open questions, deadlines.
5. Return a structured list grouped by project or topic.
