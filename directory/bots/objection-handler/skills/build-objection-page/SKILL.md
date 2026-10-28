---
name: build-objection-page
description: Create or refresh the shareable page from memory.
---

1. Read the "objections" array from memory. 2. If empty, tell the person there is nothing to show and stop. 3. Build a Markdown table with headers Objection and Answer. 4. Add a heading "Objection Answers" and a line "Last updated: <today>". 5. Call make_page with the Markdown. 6. Return the page link to the person.
