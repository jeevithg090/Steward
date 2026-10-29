---
name: analyse-cost
description: Calculate total wasted cost from the log.
---

1. Read the waste log file using file_read. 2. If the file is empty or does not exist, say 'No waste logged yet' and stop. 3. Skip the header line. 4. For each remaining line, split by comma. 5. Take the cost value (the third part), convert it to a number, and add it to a running total. 6. If any line does not have a valid cost, ignore that line and continue. 7. After all lines are processed, show the total cost to the person.
