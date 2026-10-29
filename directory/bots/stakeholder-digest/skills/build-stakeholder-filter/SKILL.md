---
name: build-stakeholder-filter
description: Ask the person for the list of stakeholder senders or subjects. Save the list. Use it to filter mail each morning.
---

1. List the last 30 days of mail using mail_list. 2. Ask the person to name senders or subjects that are key stakeholders. 3. If they give a list, remember it with memory_remember. 4. If they say nothing, say 'I have saved nothing and will not filter.' 5. When the list exists, create a routine with routine_create that runs each morning. 6. The routine lists today's mail with mail_list, filters by the saved senders, and picks the most recent three messages. 7. Show the person the filtered list and ask if they want to send a summary or change the filter.
