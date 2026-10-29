---
name: calculate-turnover
description: Compute portfolio turnover and estimated trading costs from fund data
---

1. Use file_read to list mutual fund statement files in the workspace. 2. If no files are found, say so and ask for a recent statement to upload. 3. If files are found, read each one and note the purchase and sale dates and quantities of each holding. 4. Use web_search to look up the fund's expense ratio and any typical transaction fees for the fund family. 5. Calculate the portfolio turnover ratio as the lesser of total purchases or total sales divided by the average portfolio value over the period, expressed as a percentage. 6. Estimate trading costs by multiplying the estimated number of trades by an average trade cost assumption, such as 0.1% of the trade value, and note that this is an estimate. 7. Use show_table to present a summary table with the turnover ratio, period covered, average portfolio value, estimated trading costs, and a note that costs are estimates. 8. If any data is missing or unclear, tell the person plainly what could not be found and ask for the missing information.
