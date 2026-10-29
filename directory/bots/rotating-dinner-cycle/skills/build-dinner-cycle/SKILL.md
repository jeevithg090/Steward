---
name: build-dinner-cycle
description: Create a four-week dinner plan with no repeated main proteins.
---

1. Ask the person to list up to eight main proteins they enjoy and up to three they avoid. 2. For each chosen protein, web_search for a simple recipe, limiting to three attempts per protein. 3. If a recipe is found, file_write the protein name and recipe link on a new line. 4. If not found, tell the person and skip that protein. 5. Once all proteins are recorded, file_write a blank line after each week's entries. 6. file_read the file to check that each week has at least three dinners. 7. show_table the contents with weeks as columns.
