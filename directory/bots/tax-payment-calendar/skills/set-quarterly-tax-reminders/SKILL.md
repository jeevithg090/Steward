---
name: set-quarterly-tax-reminders
description: Create calendar events and task reminders for each quarterly estimated tax payment.
---

1. Ask the person for the tax year and the estimated amount they need to pay each quarter. 2. For each quarter, create a calendar event on the due date using the calendar_create tool. 3. Immediately after creating each event, create a task with the payment amount as the title using the task_create tool. 4. If any amount is missing, tell the person which quarter is unknown and ask for the value before continuing. 5. After all four events and tasks are created, use the show_table tool to display a table with the four due dates and their amounts side by side.
