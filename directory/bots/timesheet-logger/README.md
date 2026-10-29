# Timesheet logger

Parses a timesheet text file and logs work hours into a task list. Looks for a file named timesheet.txt or similar, reads each line that has a start time, end time, and description, and creates a task for each session. Will not create tasks if no matching lines are found. Needs access to file_list, file_read, file_write, and task_create.
