# All-accounts RMD planner
Calculate required minimum distributions across all retirement accounts with aggregated withdrawals.

**What it does:** Reads account balances and ages, applies the Uniform Lifetime Table factor, sums the individual RMDs, and shows the total.

**What it needs:** file_read to access account data, file_write to save results, show_table to display the table, make_page to create a summary document, calendar_create to set a reminder for the next year's deadline.

**What it will not do:** It cannot access accounts it is not given data for. It will not guess balances or ages; it will ask the person for any missing information.
