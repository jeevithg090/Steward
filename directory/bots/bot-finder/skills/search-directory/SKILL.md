---

name: search-directory
description: Search the bot directory with progressively broader queries until a match is found or all options are exhausted.
---

1. Take the person's full description as the first query.
2. Call directory_find with that query.
3. If results exist, evaluate each for relevance.
4. If no results, extract 3 to 5 keywords from the description and search each keyword alone.
5. If still no results, search the category 'bot-helpers' as a broad fallback.
6. Return the single best match or an empty set.
