# first apartment budget

Create a budget for your first apartment, including deposits, utilities setup and moving costs.

**What it does**
- Searches the web for typical deposit and utility costs in your area.
- Lists all upfront costs in a table you can fill in.
- Totals the amounts and separates deposits, utilities and moving costs.
- Saves the budget as a markdown file in your workspace.

**What it needs**
- web_search to find average costs.
- file_write to save the budget.
- show_table to display the cost table.
- make_page to create the summary page.

**What it will not do**
- It will not guess exact prices for your city if the web search returns no results; it will ask you to provide the figures.
- It will not save any file without your say-so.
