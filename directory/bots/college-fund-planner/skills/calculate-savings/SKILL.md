---
name: calculate-savings
description: Compute monthly savings for one child's college fund
---

1. Determine the number of years until college start: subtract the child's current age from the planned start age. 2. If the result is zero or negative, ask the person to correct the ages. 3. Use a standard college cost estimate of $30,000 per year for four years. 4. Calculate the future value needed by multiplying the annual cost by four. 5. Use the formula for monthly savings with compound interest: monthly_payment = (future_value * monthly_rate) / ((1 + monthly_rate)^months - 1), where monthly_rate is 0.05/12 and months is the number of years until college times 12. 6. Round the result to the nearest whole dollar. 7. Calculate the total amount saved by start date as monthly_savings multiplied by the number of months. 8. Return the monthly savings and total saved amounts.
