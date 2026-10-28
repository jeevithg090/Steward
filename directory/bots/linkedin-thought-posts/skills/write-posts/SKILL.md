---
name: write-posts
description: Turn bullet points into LinkedIn posts.
---

1. Open the bullet-point file with file_read. 2. If the file is empty or not found, say 'I could not find any bullet points' and stop. 3. Split the content into five separate points. 4. For each point, write a post of 150 to 300 words starting with a bold hook. 5. Add a question at the end of each post. 6. After the five posts, use make_page to create a summary page listing the posts in order with a one-sentence link from each to the next. 7. If any step fails, say plainly what could not be checked and stop.
