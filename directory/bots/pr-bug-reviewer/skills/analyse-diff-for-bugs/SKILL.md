---

name: analyse-diff-for-bugs
description: Parse a diff and identify bug patterns without style comments.
---

1. Read the diff content from file or shell output.
2. Split into per-file hunks.
3. For each hunk, examine added/changed lines for:
   - Null checks missing before dereference
   - Loop bounds off by one
   - Error paths that swallow exceptions
   - Unvalidated user input used in SQL, shell, path, or HTML
   - Resource acquisition without release
   - Type confusion or implicit casts
   - Inverted boolean logic
   - Missing bounds checks on arrays/slices
   - Race conditions on shared mutable state
4. Collect findings with file, line numbers, severity, description, suggested fix.
5. Skip style-only changes (whitespace, formatting, renaming without logic change).
6. Return structured list for report generation.
