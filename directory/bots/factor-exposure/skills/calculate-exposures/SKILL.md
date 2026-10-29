---
name: calculate-exposures
description: Compute the weighted average for each factor using the portfolio weights. Sort companies by market cap to determine size exposure.
---

1. Sort the companies by market cap from largest to smallest. 2. Calculate the size exposure as the weighted average of the size ranks, where rank 1 is the largest company. 3. Calculate the value exposure as the weighted average of the P/E ratios, inverted so that lower P/E gives higher value score. 4. Calculate the momentum exposure as the weighted average of the six-month price returns. 5. Calculate the quality exposure as the weighted average of the return on equity values. 6. If a metric is 'unavailable', exclude it from the weighted average and note the number of missing values.
