---
name: find-and-check-videos
description: Search and verify free short core videos.
---

1. Use web_search with the query "free core strength workout under 20 minutes". 2. For each result, use web_fetch to open the page. 3. Look for the video length on the page; keep only videos that are 20 minutes or shorter. 4. Check that the video is free; if a sign-in or payment is required, discard it. 5. Record the title, URL, and length of each valid video. 6. Repeat until three valid videos are found or the search is exhausted. 7. Use make_page to create a simple list of the collected videos with title, link, and length.
