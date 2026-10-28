---

name: fee-impact-calculation
description: Calculates and displays how different expense ratios affect long-term returns.
---

1. Set assumptions: starting capital, gross annual return, investment horizon in years.
2. Define expense ratios to compare.
3. For each ratio: net return = gross return - expense ratio; final value = starting capital * (1 + net return) ^ years; gross final value = starting capital * (1 + gross return) ^ years; total fees = gross final value - final value; fees as % of gross gain = total fees / (gross final value - starting capital) * 100.
4. Build table rows for each ratio.
5. Call show_table with the comparison data.
6. Call make_page with definition, assumptions, table, and key takeaway.
