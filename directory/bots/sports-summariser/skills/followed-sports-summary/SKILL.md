---
name: followed-sports-summary
description: Summarise last night's games for followed sports
---

1. Check memory_remember for the person's list of followed sports. 2. If the list is empty or missing, ask the person which sports they follow and save the list. 3. For each sport in the list, use web_search to find last night's results. 4. Use web_fetch to read the top result and extract the final score and a one-sentence highlight. 5. If a sport has no games, note that. 6. If a search returns no results, say the score is unknown. 7. Collect all scores and highlights into a single list. 8. Present the list to the person, grouped by sport, and note any sports with no games.
