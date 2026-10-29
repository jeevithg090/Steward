---
name: build-combinations
description: Create every base-protein-vegetable-garnish row.
---

1. Ask the person for a list of bases, proteins, vegetables and garnishes. 2. For each base, loop through every protein and write a row: base + protein. 3. For each of those rows, loop through every vegetable and add the vegetable to the row. 4. For each of those, loop through every garnish and add the garnish. 5. If any category list is empty, say 'I have no X to pair. Add more?' and stop that branch. 6. When all loops finish, you will have a full grid of combos.
