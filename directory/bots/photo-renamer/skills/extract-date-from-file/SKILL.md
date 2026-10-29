---
name: extract-date-from-file
description: Read a file's metadata to find the date it was taken.
---

1. Use shell_run to run exiftool on the file and capture the output. 2. Look for the line that starts with "Date: " or "Create Date". 3. Extract the date part in YYYY:MM:DD format. 4. If no date line is found, report that the file has no date.
