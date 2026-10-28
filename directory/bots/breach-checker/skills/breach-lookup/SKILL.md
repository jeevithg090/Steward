---
name: breach-lookup
description: Queries public breach databases for a given email address.
---

1. Ask the person for the email address to check.
2. Search for public breach lookup services using web_search.
3. For each service found, use web_fetch to query the email address.
4. Parse results for breach names, dates, and exposed data categories.
5. If a service blocks or errors, note it and try the next.
6. Compile all findings into a summary table.
7. Present the table to the person.
