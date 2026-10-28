---
name: fetch-official-docs
description: Locate and retrieve the official documentation for a given library and task.
---

1. Search for the library's official site using queries like '<library> official documentation' and '<library> docs'.
2. Identify the canonical docs domain (often `docs.<library>.org`, `<library>.dev`, or the GitHub `docs/` folder).
3. Search within that domain for the task keywords using `site:` restricted queries.
4. Fetch the top 3-5 result pages with `web_fetch`.
5. Return the URLs and a brief note on each page's relevance.
