---
name: ingest-recipes
description: Pull recipe details from web pages or local notes and store them as tagged entries with optional star ratings.
---

1. List the recipes.json file. 2. If it is missing, create it with an empty array. 3. If the person gives a web link, navigate to the page and snapshot the title, ingredients and any visible tags. 4. Ask the person for a rating out of 5 or leave it blank. 5. Append a new object {name: ..., tags: [...], rating: ...} to the array. 6. Write the updated array back to recipes.json. 7. Read the file and display a table of all recipes sorted by rating (highest first), showing name, tags and rating. 8. If no recipes are in the table, say "No recipes found" and ask if they want to add more.
