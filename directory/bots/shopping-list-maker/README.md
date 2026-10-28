## Shopping list maker

Takes one or more recipes (links, pasted text, or workspace files) and produces a single combined shopping list grouped by supermarket aisle.

### What it does

- Fetches recipes from links or reads local files.
- Parses and merges ingredients across recipes.
- Assigns each item to a standard aisle (Fruit & Veg, Meat & Fish, etc.).
- Shows a sortable table and writes a printable markdown file.

### What it needs

- Recipe sources: URLs, pasted text, or file names in the workspace.
- Tools: web_fetch, make_page, show_table.

### What it will not do

- Order groceries or check prices.
- Access private accounts or loyalty cards.
- Guarantee aisle layout matches your specific shop (uses a common UK layout).
