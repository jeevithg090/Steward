---
name: fetch-textbook-details
description: Gather verified details for a single textbook candidate.
---

1. Search for the textbook title plus "review", "table of contents", or "sample chapter".
2. Open the most relevant result (publisher site, university syllabus, or reputable review).
3. Extract: publication year, intended audience, prerequisites listed, exercise style (drills, projects, proofs), and any price mentioned.
4. If a sample chapter is linked, fetch the first few pages to gauge tone and difficulty.
5. Return a structured note with every field cited to a source URL. Mark missing fields as "unknown".
