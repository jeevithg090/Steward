---
name: build-rota
description: Build a fair rotating chore schedule from chores, frequencies, people and constraints.
---

1. Collect chores with frequencies and effort ratings (1 to 3).
2. Expand each chore into slots for the rota period.
3. Calculate total slots and target slots per person.
4. Assign slots to people using a round-robin with constraint checking.
5. Spread each person's slots across weeks.
6. Output table and page.
