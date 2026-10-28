---
name: verify-resources-online
description: The agent takes each cited name and searches the web to see if it is a real dataset or repository.
---

1. Take one name from the temporary file. 2. Use web_search with the name and the word "dataset" or "repository". 3. Use browser_snapshot to look at the top results. 4. If a matching result is found, write the URL and a short description to the output file. 5. If no result is found or the search returns no clear match, write that the resource could not be verified online. 6. Move to the next name until all are checked.
