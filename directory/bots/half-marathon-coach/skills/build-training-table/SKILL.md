---

name: build-training-table
description: Creates the week-by-week training table with distances and run types.
---

1. Calculate total weeks from start date to race date.
2. Set base long run from current volume (typically 8 to 10 km for beginners).
3. For each week: assign run days, set long run distance, add tempo/interval session every 1 to 2 weeks, insert cutback week every 3 to 4 weeks.
4. Ensure peak long run 18 to 20 km at week minus 2.
5. Taper final two weeks.
6. Output as markdown table for show_table.
