---
name: lock-implementation
description: Write the acquire and release logic for a Redis distributed lock.
---

1. Use SET lock_key unique_value NX PX timeout_ms to attempt acquisition. 2. If OK, return the unique value as the lock token. 3. To release, run a script that deletes the key only if it matches the token using EVAL "if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end" 1 lock_key token. 4. Handle the case where the lock key does not exist by saying so and not attempting to release.
