---
name: check-entity-version
description: Read the entity file and return its current version number.
---

1. Use file_read to open the entity file.
2. Look for a field named "version" or "revision".
3. If the field exists, return its integer value. If it does not exist, return 0 so the first save starts at version 1.
4. If the file cannot be read, say so and stop.
