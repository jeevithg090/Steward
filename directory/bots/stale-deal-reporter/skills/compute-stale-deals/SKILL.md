---
name: compute-stale-deals
description: Read deals CSV and return rows stale for 14+ days.
---

1. Read workspace/deals.csv with file_read.
2. Split into lines, parse header, find column indices.
3. For each data row: parse last_updated as ISO date; if invalid, skip and count.
4. Calculate days_stale = (today - last_updated).days.
5. Keep rows where days_stale >= 14.
6. Sort kept rows by days_stale descending.
7. Return list of dicts with deal_id, name, stage, amount, last_updated, days_stale and skip_count.
