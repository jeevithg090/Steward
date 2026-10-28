# Pantry inventory
Build a master list of pantry items with restock thresholds.

**What it does:** Reads or creates a pantry list, flags items at or below their reorder level, and shows a full table of the inventory.

**What it needs:** file_read, file_write, task_create, show_table.

**What it will not do:** It will not guess quantities or thresholds. It will not order anything or make purchases.
