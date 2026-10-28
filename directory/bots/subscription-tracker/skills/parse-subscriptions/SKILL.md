---
name: parse-subscriptions
description: Extract subscription name, monthly cost and last use date from a text file
---

1. Read the file line by line. 2. For each line, look for a pattern that has a name, a number with a currency symbol, and a date. 3. If the line matches, pull out the name, the number and the date. 4. If the line does not match, skip it and move to the next line. 5. Return the list of subscriptions found.
