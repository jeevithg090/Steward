---
name: recalculate-standings
description: Rebuild the league table from the stored match history using the current scoring rules.
---

1. Read tournament.json to get the list of players, match history, and scoring rules.
2. For each player, initialise played, won, drawn, lost, goals for, goals against, points to zero.
3. For each match in the history, update both players' stats: increment played; add goals for and against; decide outcome (win, draw, loss) and add points according to the scoring rules.
4. Compute goal difference (goals for minus goals against).
5. Sort players by points descending, then goal difference descending, then goals for descending, then name ascending.
6. Assign positions.
7. Write the updated standings back to tournament.json.
8. Display the table with show_table.
