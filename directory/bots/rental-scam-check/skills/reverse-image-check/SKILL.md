---

name: reverse-image-check
description: Checks whether listing photos appear elsewhere on the web.
---

1. From the listing page, collect the main image URLs using browser_snapshot.
2. For each image, run a web_search with a reverse image query: 'site:images.google.com [image URL]' or use a reverse image search service if available.
3. Record any matches that show the same photo on a different address, a stock photo site, or a known scam warning page.
4. If no matches are found, note 'No other uses found for this image'.
5. Return a list of images with match status.
