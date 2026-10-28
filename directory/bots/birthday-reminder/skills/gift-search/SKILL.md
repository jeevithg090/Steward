---

name: gift-search
description: Search for a gift idea based on a person's name or age.
---

1. Build a search query: if the event title includes an age (e.g. "Sarah 30th birthday"), use "gift ideas for 30 year old". Otherwise use "popular birthday gifts [current year]".
2. Call `web_search` with the query.
3. Pick the first result that looks like a gift guide or product list.
4. Extract one or two concrete suggestions (e.g. "wireless headphones", "coffee subscription").
5. If no results, return "No specific ideas found; consider a gift card or experience.".
