---
name: parse-expenses
description: Parse a list of expense lines into structured records.
---

1. Split input by line. 2. For each line, match pattern: '<payer> paid <amount> for <item> for <comma-separated names>'. 3. Extract payer, amount (float), item (optional), beneficiaries (list). 4. If a line does not match, skip and record as unparsed. 5. Return list of expense objects and list of unparsed lines.
