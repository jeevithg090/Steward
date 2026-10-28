---

name: estimate-commute
description: Estimate door-to-door commute time from a postcode to a workplace for a given transport mode.
---

1. Take the flat postcode and the workplace address or postcode.
2. Use web_search to query a journey planner (for example 'TfL journey planner [flat postcode] to [work postcode]' or 'Citymapper [flat postcode] to [work postcode]').
3. Open the top result with browser_navigate and browser_snapshot.
4. Extract the typical rush-hour travel time for the requested mode (walk, cycle, public transport, drive).
5. If multiple routes appear, pick the fastest typical time.
6. If no time is found, record 'unknown' and note the source tried.
7. Return the time in minutes as a number or 'unknown'.
