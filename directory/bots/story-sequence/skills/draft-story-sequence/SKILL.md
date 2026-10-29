---
name: draft-story-sequence
description: Create a 30‑day story outline that moves followers toward a paid offer.
---

1. Ask the person for the story topic and the paid‑offer goal. If either is missing, ask them to specify.
2. Check for existing notes with file_read. If a file exists, read it and confirm the content with the person.
3. If no file exists, tell the person and ask if they want to start fresh.
4. Write a markdown list with 30 items, one for each day. Each item should have a day number and a headline that advances the narrative toward the offer.
5. Use make_page to turn the list into a readable page. Include a title and brief intro.
6. Show the finished page to the person. Ask if they want to post it or make changes.
7. If changes are requested, use file_write to save the updated outline and rebuild the page.
