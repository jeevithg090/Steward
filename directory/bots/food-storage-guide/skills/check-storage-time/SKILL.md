---
name: check-storage-time
description: Search for the food name plus 'refrigerator storage time'. Read the top result. If the page says a time in days, note it. If the page says 'eat within X days', note that. If no time is found, note that no time could be found.
---

1. Use web_search with the food name and 'refrigerator storage time'. 2. Use web_fetch to open the first result. 3. Look for a sentence that gives a number of days or a 'eat within' statement. 4. If found, note the time and the storage method. 5. If not found, note that no storage time could be checked.
