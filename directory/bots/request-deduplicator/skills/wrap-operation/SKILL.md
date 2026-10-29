---
name: wrap-operation
description: add deduplication around a function
---

1. Read the target function. 2. Create a new wrapper that computes a hash of its arguments. 3. Check an in‑memory map guarded by a mutex. 4. If a result exists, return it. 5. Otherwise, call the original function, store its return value, and return that. 6. Delete the entry when the call finishes.
