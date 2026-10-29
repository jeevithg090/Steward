---
name: remove-exports
description: Delete dead export names from export statements in source files.
---

1. For each file that defines a dead export, read it with file_read. 2. Find the export statement that contains the dead name. 3. Remove the dead name from the statement, keeping the rest of the exports. 4. Write the modified file with file_write. 5. If the export statement becomes empty, remove the export keyword or the entire statement.
