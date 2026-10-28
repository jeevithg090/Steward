---
name: scan-trading-history
description: Look through trading records to find wash sales from last year.
---

1. List files in the workspace with file_list. 2. Read the trading history file with file_read. 3. Identify each sale of a security at a loss. 4. For each loss sale, check if there was a buy of the same symbol within 30 days before or after the sale date. 5. Record the sale date, buy date, symbol, and loss amount for every wash sale found. 6. When finished, use show_table to display the results. 7. If no wash sales are found, say so and show an empty table.
