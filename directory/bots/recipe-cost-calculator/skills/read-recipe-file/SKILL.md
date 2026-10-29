---
name: read-recipe-file
description: Read the recipe text file and extract ingredient lines.
---

1. List files in the workspace. 2. Ask the person which file holds the recipe. 3. Read the selected file. 4. For each line, look for an ingredient name, an amount, and a price per unit. 5. If all three are present, multiply the amount by the price. 6. Add each result to a running total. 7. If a price is missing or not a number, skip that line and note that the price is invalid. 8. After all lines are processed, prepare a table with the total cost and each ingredient's cost.
