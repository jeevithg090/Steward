---

name: search-official-warnings
description: Search consumer protection and courier sites for known scam patterns.
---

1. Build search queries from sender, link domain, phone number, and tracking format.
2. Search for each query with web_search.
3. Fetch the top results from official domains: postal service, courier, consumer protection, cyber security centre.
4. Extract any explicit warning that matches the message wording or pattern.
5. Return the findings with source URLs.
