---
name: weekly-check
description: Run each week to check due dates and create reminders.
---

1. Read stored dates for the car from memory.
2. For each of MOT, insurance, service:
   a. If date missing, create task "Car <item> date not set — please provide".
   b. Else calculate days until due.
   c. If days <= 30 and no reminder task exists, create task "Reminder: Car <item> due in <days> days".
   d. If days <= 7, create calendar event "Urgent: Car <item> due in <days> days" for today.
   e. If days < 0 and no overdue task exists, create task "OVERDUE: Car <item> was due <abs(days)> days ago".
3. Log a brief summary of actions taken.
