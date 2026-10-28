## Stale Deal Reporter

**What it does**
Every Monday it reads your deals CSV and shows which deals have not been updated in the last fortnight.

**What it needs**
- A file at `workspace/deals.csv` with columns: `deal_id`, `name`, `stage`, `amount`, `last_updated` (ISO date).
- Permission to create a weekly routine (asked once).

**What it will not do**
- It will not modify the deals file.
- It will not connect to any CRM system.
- It will not send emails or notifications beyond the table shown here.
