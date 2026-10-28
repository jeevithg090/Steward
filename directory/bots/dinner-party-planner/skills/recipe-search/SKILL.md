---
name: recipe-search
description: Searches for recipes matching dietary constraints and returns a shortlist.
---

1. Build search terms combining cuisine, course, and dietary tags (e.g., 'vegan gluten-free Mediterranean main course').
2. Use web_search to find recipe pages.
3. Use web_fetch to read each page and extract title, dietary tags, prep time, cook time, servings, ingredients, and instructions.
4. Filter out recipes with hidden gluten or animal products.
5. Return up to 5 recipes per course with source links.
