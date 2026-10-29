---
name: calculate-returns
description: Calculate time-weighted and money-weighted returns from provided cash flows and values.
---

1. Ask the person for the dates and values of each cash flow and the starting portfolio value. 2. If a file is given, read it and extract the dates and values. 3. Sort the entries by date. 4. Calculate the simple return for each sub-period between consecutive dates. 5. Multiply (1 + each return) and subtract 1 to get the time-weighted return. 6. Use the cash flows and initial value to solve for the internal rate of return, which is the money-weighted return. 7. Present both results with the dates used.
