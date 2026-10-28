---

name: show-log
description: Display a medication adherence log for a given period.
---

1. Retrieve the schedule from memory_remember key "med_schedule". If missing, say so and stop.
2. List tasks with tag "medication" from the last 30 days (or the period the person asks for).
3. For each medication and date, match planned times from the schedule to actual completed tasks.
4. Build a table: Medication | Date | Planned Time | Taken Time | Status.
5. Highlight missed doses (planned with no completed task).
6. Show the table to the person.
