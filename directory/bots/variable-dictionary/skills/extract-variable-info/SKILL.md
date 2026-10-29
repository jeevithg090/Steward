---
name: extract-variable-info
description: read each file, list every variable, note its data type and any existing labels
---

1. Open the first file with `file_read`. 2. Scan the contents for headings that look like variable names (often at the top or in a "variables" section). 3. Record the name, the data type (text, number, date) and any attached label or value label. 4. Repeat for every file in the folder. 5. If a file is a spreadsheet, also note the sheet name. 6. Save this list as a temporary note; it will be the basis for the dictionary.
