---
name: search-and-collect-recipes
description: Find and save slow cooker recipes with 8-10 hour cook times.
---

1. Use web_search with the query "slow cooker recipe 8-10 hours". 2. Read the search results with browser_snapshot. 3. Select up to five recipes that show a cook time of 8 to 10 hours. 4. For each selected recipe, use web_fetch to open the full page. 5. Copy the ingredient list and the step-by-step directions. 6. If a page has no cook time, discard it and go to the next result. 7. When all chosen recipes are saved, use file_write to store the ingredient and step data in a text file named slow_cooker_recipes.txt.
