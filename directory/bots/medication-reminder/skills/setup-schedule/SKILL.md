---

name: setup-schedule
description: Collect medication details and create daily reminder routines.
---

1. Ask for each medication: name, dose, and one or more times in 24-hour format.
2. Confirm the list with the person.
3. For each medication and time, call routine_create with a cron-like schedule for that time each day. The routine action creates a task via task_create titled "Take [name] [dose]" with tag "medication".
4. Save the full schedule (name, dose, times) using memory_remember under key "med_schedule".
5. Tell the person the reminders are active and how to view the log.
