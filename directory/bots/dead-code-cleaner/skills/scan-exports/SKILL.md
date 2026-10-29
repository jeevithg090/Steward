---
name: scan-exports
description: Collect named exports from all source files in a package using file_read. Store the export names in a list. Then use file_read on every import file to build a used-exports list. Compare the two lists; any export in the first list not in the second is dead.
---

1. Read the package root directory with file_list. 2. For each .js or .ts file, read it with file_read. 3. Extract export names from export statements. 4. Read every other file in the workspace that imports from this package. 5. Record which export names appear in those import statements. 6. The difference between the export list and the used list is the dead exports.
