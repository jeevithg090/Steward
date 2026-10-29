---
name: calculate-bands
description: Turn volatility numbers into rebalancing bands.
---

1. For each asset class, take the annualised volatility percentage from the data. 2. Multiply that figure by two to get the suggested band width. 3. Split the width equally above and below the current allocation target. 4. Round both the lower and upper limits to the nearest 5 percentage points. 5. If the result gives a lower limit above 100% or a upper limit below 0%, adjust the target allocation first so the band fits within 0–100%. 6. Record the final lower and upper limits for each asset.
