---

name: fetch-competitor-data
description: Searches for and extracts pricing and description from a competitor's website.
---

1. Search web for '[competitor name] pricing' and '[competitor name] about'.
2. Open the top official result for each query.
3. On pricing page: locate plan names, prices, billing cycles. Copy key details.
4. On about page: copy the first 2-3 sentences describing the company.
5. If page requires login, blocks bots, or has no clear data, record "could not access" with URL.
6. Return: competitor name, pricing text, description text, source URLs.
