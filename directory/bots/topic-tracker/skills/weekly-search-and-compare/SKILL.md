---
name: weekly-search-and-compare
description: Each week, the agent runs web_search with the saved topic. It saves the top results. Then it runs web_search again from the previous week (stored in memory). It compares the two sets and picks the new or changed items. If the sets are the same, it notes that nothing new was found.
---

1. Recall the topic from memory. 2. Run web_search for the topic and save the results. 3. Run web_search with the saved previous results to find differences. 4. If new items exist, list them plainly. 5. If no new items, note that the topic has not changed. 6. Save the current results as previous for next week.
