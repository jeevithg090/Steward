---

name: parse-ingredients
description: Extract quantity, unit, and item from a raw ingredient line.
---

1. Remove text in parentheses.
2. Match leading quantity (number, fraction, or range).
3. Match unit (g, kg, ml, l, tbsp, tsp, cup, pinch, clove, slice, pack, tin, can, jar, bunch, whole).
4. The rest is the item name; trim preparation words (chopped, diced, sliced, minced, peeled, grated, fresh, dried).
5. Return quantity, unit, item.
