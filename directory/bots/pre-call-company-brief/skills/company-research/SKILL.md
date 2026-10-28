---

name: company-research
description: Gather and verify public company information for a sales brief.
---

1. Confirm company name, preferred source URLs, and call context with the person.
2. Run web_search queries: overview, leadership, news (90 days), funding, competitors, tech stack.
3. Fetch top results with web_fetch; skip paywalls and low-quality sites.
4. Extract structured facts: description, HQ, size, products, leaders, news, funding, competitors, social proof, pain points.
5. Mark any missing fact as "Not found in public sources".
6. Return a structured summary for the page builder.
