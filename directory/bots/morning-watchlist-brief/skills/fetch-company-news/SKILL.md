---

name: fetch-company-news
description: Search and fetch recent news for one company.
---

1. Run web_search with query "{company} news last 24 hours".
2. Collect up to 3 result URLs.
3. For each URL, run web_fetch.
4. From each fetched page, extract headline, publication date, source name, and write a 2-sentence summary.
5. Return a list of article objects or an empty list if nothing found.
