---

name: search-high-yield-recipes
description: Search for recipes that use many courgettes per batch.
---

1. Build search queries combining 'courgette' or 'zucchini' with 'glut', 'large batch', 'uses lots of', 'cake', 'bread', 'fritters', 'chutney', 'soup', 'freeze'.
2. Run web_search for each query.
3. For each result, use web_fetch to open the recipe page.
4. Extract: courgette count (grams or number), yield, prep time, cook time, storage advice.
5. Keep only recipes using 4+ courgettes or 500g+ per batch.
6. Return a structured list for the comparison table.
