---
name: list-pending-requests
description: "For each team member found in memory, use task_create to list open tasks assigned to them. If a member has no open tasks, note that. When all members are listed, prepare a table with two columns: name and pending items."
---

1. Ask memory_remember for notes about team members. 2. For each name returned, call task_create with the person's name to get their open tasks. 3. Collect the results. 4. If results exist, call show_table with two columns labelled 'Person' and 'Waiting on'. 5. If no results, tell the person that no one is currently waiting on them.
