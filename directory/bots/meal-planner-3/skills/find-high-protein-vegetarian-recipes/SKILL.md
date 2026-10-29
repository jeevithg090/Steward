---
name: find-high-protein-vegetarian-recipes
description: Search the web for vegetarian recipes that list protein content per serving. Collect at least 14 recipes (two per day) that provide around 20g protein each, which will sum to roughly 100g daily. If a recipe has no protein figure, discard it and search for another.
---

1. Use web_search with the query "high protein vegetarian recipe per serving". 2. Use web_fetch to read the top results. 3. Look for protein grams on the page; if missing, close and search again. 4. Save each recipe that has 15g protein or more in a list. 5. Stop when 14 recipes are saved or after ten searches, whichever comes first.
