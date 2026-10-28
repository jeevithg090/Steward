---
name: calculate-capital-gains
description: Work out the tax owed on shares sold after three years.
---

1. Use web_search to find the current tax‑free allowance and the 10 % / 20 % rates for assets held over one year. 2. Use web_fetch or browser_navigate to locate the person's share purchase price and the current selling price, if they have been entered into their records. 3. Subtract the allowance from the gain. 4. Check whether the remaining gain falls in the basic or higher income tax band. 5. Apply the correct rate and display the tax amount on a make_page output. 6. If any step finds no data, say what could not be checked and do not invent a number.
