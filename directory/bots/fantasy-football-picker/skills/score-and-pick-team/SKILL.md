---

name: score-and-pick-team
description: Score players by form and fixture difficulty, then pick the best legal squad.
---

1. Gather form stats for the last 5 gameweeks: points per game, minutes, xG, xA, bonus.
2. Assign a fixture difficulty rating for each opponent (1 easy to 5 hard).
3. Calculate a score: form points per game multiplied by (6 minus difficulty) divided by 5.
4. Filter out injured, suspended or doubtful players.
5. Run a greedy optimisation: fill each position slot with the highest‑scoring available player while respecting budget, club limit and formation rules.
6. Select captain and vice‑captain from the starting attackers with the highest scores.
7. Output the final squad table and notes.
