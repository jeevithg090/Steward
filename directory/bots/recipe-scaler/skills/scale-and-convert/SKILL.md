---
name: scale-and-convert
description: Parse ingredients, scale quantities, convert to grams using standard densities.
---

1. Parse each ingredient line into quantity, unit, and name. Flag unparsable lines.
2. Compute scaling factor: 11 / 4 = 2.75.
3. For each ingredient, multiply quantity by 2.75.
4. Convert scaled quantity to grams: if unit is g or kg, convert directly; if volume (ml, cup, tbsp, tsp), multiply by density (water 1, flour 0.5, sugar 0.85, butter 0.96, salt 1.2, honey 1.4, oil 0.92, milk 1.03, egg ~50g each).
5. Round: nearest gram for >=10g, one decimal for <10g.
6. Build table with original, scaled original unit, and grams.
7. Generate printable page with scaled gram list, scaling factor, and density disclaimer.
