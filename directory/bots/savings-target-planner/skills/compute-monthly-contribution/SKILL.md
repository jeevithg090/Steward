---
name: compute-monthly-contribution
description: Solve for the monthly payment needed to reach a future value with compound interest.
---

1. Convert annual rate to monthly decimal: r = annual_rate / 12 / 100.
2. If r > 0: P = (FV - PV * (1 + r)^n) * r / ((1 + r)^n - 1).
3. If r == 0: P = (FV - PV) / n.
4. Round P up to two decimal places.
5. Return P.
