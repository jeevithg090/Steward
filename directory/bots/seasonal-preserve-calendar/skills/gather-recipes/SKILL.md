---
name: gather-recipes
description: Search the web for small-batch preserve recipes for the chosen season. For each result, note the recipe name, the main fruit or vegetable, the preserving method and any equipment mentioned. Stop after finding three recipes or when no more are found.
---

1. Use web_search with the query 'small-batch [season] preserve recipes'. 2. Read the search results with browser_snapshot. 3. For each recipe page, use browser_snapshot to find the method and equipment list. 4. Write the recipe name, produce, method and equipment to a temporary list. 5. If three recipes are collected, stop. 6. If fewer than three are found, say so and stop.
