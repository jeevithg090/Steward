---
name: find-and-replace-codemod
description: Locate deprecated API calls and replace them with the new API. Start by reading the file to find the exact pattern. When found, use file_write to save the updated content. If the pattern is not in the file, move on. After processing all files, report the total number of replacements made.
---

1. List files in the workspace. 2. For each source file, read its content. 3. Search for the deprecated API name. 4. If found, replace it with the new API name. 5. Write the modified content back to the file. 6. Keep a count of changes per file. 7. Report the summary to the person.
