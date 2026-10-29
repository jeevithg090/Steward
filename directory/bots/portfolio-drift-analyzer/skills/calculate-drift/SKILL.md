---
name: calculate-drift
description: Compute sector and factor drift from portfolio data.
---

1. Read the portfolio holdings file and identify each holding's sector, factor, current market value, and total portfolio value. 2. Read the target allocation file and note the target percentage for each sector and factor. 3. Calculate the current weight of each sector/factor by summing the market values and dividing by total portfolio value. 4. Compute the drift as current weight minus target weight. 5. Note the absolute value of the drift and whether it is positive (overweight) or negative (underweight). 6. If the person has multiple files or complex structures, use shell_run to run a simple Python or awk script to perform the calculations, then capture the output. 7. Build a table with columns: sector/factor, target weight, current weight, drift amount, drift direction.
