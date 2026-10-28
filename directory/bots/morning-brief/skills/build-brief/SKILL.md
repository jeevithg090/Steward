---
name: build-brief
description: Assembles the morning brief from mail, calendar, and tasks.
---

1. Check if today is a weekday. If weekend, stop and say no brief on weekends.
2. Run brief_today to get mail and calendar summary.
3. Query tasks due today or overdue.
4. Combine all sections into one brief.
5. If any connector is missing, report which one and stop.
6. Present the brief to the person.
