---
name: citation-chain-follow
description: Follow a chain of citations from a given URL back to the earliest accessible source.
---

1. Fetch the starting URL with web_fetch. 2. Extract all outbound links, citations, DOIs, arXiv IDs, PMID numbers, and named references. 3. For each candidate earlier source, fetch it and repeat. 4. Stop when a page has no earlier citations, is a recognised primary source type, or 10 hops are reached. 5. Return the ordered list of hops with dates and citation types.
