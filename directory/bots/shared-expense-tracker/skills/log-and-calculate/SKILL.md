---
name: log-and-calculate
description: Record shared cost entries and compute monthly net balances.
---

1. When the person gives a cost, write a line to the log file in the format: YYYY-MM-DD | payer | description | amount. 2. Read the log file and sum amounts per person. 3. Subtract each person's total from the group total to find net balance. 4. If a person has a negative balance, they owe money; if positive, they are owed money. 5. Show the result as a simple list of names and balances.
