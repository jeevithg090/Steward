---
name: parse-conventional-commits
description: Groups commit messages by conventional commit type.
---

1. Take the raw git log output (hash, subject, author).
2. For each line, extract the prefix before the first colon (e.g., 'feat', 'fix', 'chore').
3. Normalise the prefix to lowercase.
4. Map known prefixes to display categories: feat -> Features, fix -> Bug Fixes, docs -> Documentation, refactor -> Refactoring, test -> Tests, chore -> Chores, perf -> Performance.
5. Place commits with unrecognised or missing prefixes into an 'Other' category.
6. Return a structured object mapping category names to arrays of commit objects.
