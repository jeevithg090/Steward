---
name: record-trade
description: Save a trade and the person's thought to memory and to a file.
---

1. Ask the person for the trade details: what was bought or sold, the price, the date, and what they were thinking at the time. 2. Use memory_remember to store the trade and the thought as a fact about the person. 3. Use file_write to open trade_log.txt and append a line in the format YYYY‑MM‑DD | [buy/sell] | price | thought. 4. If the file does not exist, create it with a header line first. 5. After writing, use show_table to display all entries from the file so the person can review them.
