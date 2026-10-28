---
name: parse-and-aggregate
description: Parse timestamps, bucket by day and hour, compute average engagement per bucket.
---

1. Load the data file (CSV or JSON) from the workspace.
2. Identify the timestamp column and the primary engagement metric column.
3. Convert all timestamps to UTC datetime objects.
4. For each post, extract day of week (Monday=0 to Sunday=6) and hour of day (0-23).
5. Group posts by day of week, compute mean engagement for each day.
6. Group posts by hour of day, compute mean engagement for each hour.
7. Group posts by (day, hour) pairs, compute mean engagement for each pair.
8. Sort each grouping by mean engagement descending.
9. Return the top 3 day-hour pairs, best day, and best hour.
