---
name: trend-research
description: Searches and fetches trending topics for a niche from the past week.
---

1. Ask for niche, platforms and content style if not known.
2. Build search queries: "[niche] trends this week", "[niche] viral last 7 days", platform-specific queries.
3. Run web_search for each query.
4. For each result that looks relevant, run web_fetch to get details.
5. Collect: topic, why trending, popular formats, audience questions, gaps.
6. Rank by relevance and freshness. Return top five to seven trends with source URLs.
