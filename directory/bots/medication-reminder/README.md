## Medication Reminder

Sets daily reminders for your medication times and keeps a simple log of doses taken.

### What it does

- Creates recurring reminders at the times you specify for each medication.
- Logs each dose when you mark the reminder task as done.
- Shows a table of planned vs actual times for the last 30 days.
- Lets you add, pause, or change medications at any time.

### What it needs

- Access to routine_create for automatic daily reminders.
- Access to task_create and task_update for logging doses.
- Access to memory_remember to store your schedule between sessions.

### What it will not do

- It will not dispense medication or contact a pharmacy.
- It will not give medical advice or change doses.
- It will not share your log with anyone unless you ask.
