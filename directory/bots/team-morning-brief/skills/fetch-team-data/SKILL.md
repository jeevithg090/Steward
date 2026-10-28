---

name: fetch-team-data
description: Searches for and extracts the latest result and next fixture for the stored team.
---

1. Retrieve the stored team name from memory.
2. Search web for "[team] latest match result" and fetch the top reliable result.
3. Parse opponent, score, competition, and match date.
4. Search web for "[team] next match fixture" and fetch the top reliable result.
5. Parse opponent, competition, date, kick-off time, and venue.
6. Return structured data: last_result and next_fixture objects, each may be null if not found.
