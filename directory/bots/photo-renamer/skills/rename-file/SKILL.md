---
name: rename-file
description: Change a file name using the extracted date.
---

1. Build the new name by taking the extracted date, replacing the colons with hyphens, and appending the original file extension. 2. Use file_write to rename the file from its old name to the new name. 3. If the new name already exists, add a number in parentheses before the extension to avoid overwriting.
