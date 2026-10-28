---
name: categorise-usage
description: Reads each match and categorises how the setting is used.
---

1. For each match from search-setting, read the file with context (20-30 lines around the match).
2. Classify each occurrence: definition/source, direct usage, pass-through, test, or other.
3. Note the framework or config library if detectable.
4. Group results by category with file paths and line numbers.
5. Write a one-line context note for each match.
