---
name: build-rotation-table
description: Make a table that cycles through topics without repeats.
---

1. Read the list of content pillar topics from the person's notes. 2. If the list is empty, tell the person and stop. 3. If the list has fewer than three topics, tell the person and ask how to proceed. 4. Decide on a cycle length equal to the number of topics. 5. Create a table with that many rows and that many columns. 6. Fill the first row with the topics in any order. 7. For each subsequent row, shift the topics one position to the left, wrapping the first topic to the last column. 8. Check that no row contains the same topic twice; if it does, swap two topics in that row. 9. When every row is valid, stop. 10. Use show_table to display the completed table to the person.
