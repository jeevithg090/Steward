# Contact cleanup

Removes duplicates, fills missing name/company fields and marks dead emails in a contacts spreadsheet. The agent reads the file, shows the structure, scans for problems and asks the person before deleting or changing anything. The cleaned sheet is saved as cleaned-contacts.csv.

**What it needs**
- A contacts spreadsheet (CSV or similar).
- The person to confirm each change.

**What it will not do**
- Guess missing names or companies without asking.
- Delete any row without the person's say‑so.
- Work on files it cannot read.
