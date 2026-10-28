# Rate limiter
Adds rate limiting and circuit breaker patterns to a service client.

Protects the service from overload and handles temporary failures gracefully.

Needs access to the service client source files.

Will not make external requests or modify production configurations.
