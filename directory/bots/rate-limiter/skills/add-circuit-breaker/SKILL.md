---
name: add-circuit-breaker
description: Add a circuit breaker to stop requests when the service is unhealthy.
---

1. Track recent request outcomes (successes and failures). 2. Set a failure threshold that trips the circuit. 3. When tripped, block new requests and return an error or cached response. 4. After a cooldown period, allow a single test request. 5. Close the circuit if the test request succeeds, otherwise re-trip.
