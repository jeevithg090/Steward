---
name: add-rate-limiting
description: Add rate limiting to prevent too many requests in a given time window.
---

1. Check the current request rate in the codebase. 2. Choose a rate limiting algorithm (token bucket or fixed window). 3. Add a counter that increments on each request. 4. Enforce a delay or block when the limit is reached. 5. Reset the counter after the time window expires.
