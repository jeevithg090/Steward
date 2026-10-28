---

name: parse-statement
description: Parse a bank statement file into a list of transactions.
---

1. Use file_read to load the file content.
2. Detect format: if content starts with a header row and commas, treat as CSV; if binary or .xlsx extension, treat as Excel (note: file_read returns text, so Excel may need conversion first); otherwise treat as space/tab separated.
3. For CSV: split lines, parse headers, map date, description, amount columns. For text: infer columns by position or ask.
4. Return a list of objects: {date, description, amount, raw}.
5. If parsing fails, show first 10 lines and ask for help.
