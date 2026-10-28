---
name: scan-repository
description: List top-level items, then for each item decide if it is a file to read or a directory to skip. Read plain‑text files and record their path and a one‑line summary. Skip binary files and hidden directories.
---

1. Run file_list on the workspace root. 2. For every item that is a file and not binary, run file_read and capture the first line as a summary. 3. Record the path and summary. 4. Skip directories and hidden folders. 5. If a file cannot be read, note that it could not be checked.
