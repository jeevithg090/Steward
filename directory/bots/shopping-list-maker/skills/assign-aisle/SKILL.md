---

name: assign-aisle
description: Map a normalised item name to a standard supermarket aisle.
---

1. Lower-case the item.
2. Check keyword lists in order: Fruit & Veg, Meat & Fish, Dairy & Eggs, Bakery, Pantry, Canned & Jarred, Frozen, Drinks, Household.
3. First match wins.
4. If no match, return Other.
