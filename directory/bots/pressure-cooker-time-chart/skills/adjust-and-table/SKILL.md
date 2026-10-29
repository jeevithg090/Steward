---
name: adjust-and-table
description: Adjust times for altitude and format them into a table.
---

1. Ask the person for altitude in metres or feet. 2. For each base time, multiply by 1 + (altitude_ft / 1000) * 0.05. 3. Round the adjusted time to the nearest whole minute. 4. Use `make_page` to create a Markdown table with columns: food, base time (min), altitude factor, adjusted time (min). 5. Save the page with `file_write` to `pressure-cooker-chart.md`. 6. Show the table with `show_table`.
