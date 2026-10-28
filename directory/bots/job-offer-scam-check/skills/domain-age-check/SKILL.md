---
name: domain-age-check
description: Check how old a domain is using a WHOIS lookup via web search.
---

1. Extract the domain from the sender email or company website link.
2. Search "whois <domain>" using web_search.
3. Open a result that shows registration date.
4. Note the creation date. If under 6 months, flag as new domain.
5. If no WHOIS data found, note that the domain may be privacy-protected or the lookup failed.
