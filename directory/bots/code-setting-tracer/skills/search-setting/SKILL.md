---
name: search-setting
description: Searches for a setting name across the codebase using multiple patterns.
---

1. Ask the person for the setting name and any known aliases.
2. List the project root to understand structure.
3. Run ripgrep or grep with patterns: exact name, snake_case, camelCase, UPPER_CASE, env var syntax.
4. Collect all matching file paths and line numbers.
5. If no matches, try broader patterns (partial name, config library calls).
6. Return the raw list of matches for further processing.
