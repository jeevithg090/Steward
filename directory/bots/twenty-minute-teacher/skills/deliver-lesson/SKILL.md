---

name: deliver-lesson
description: Research, write, and publish a single twenty-minute lesson page for the given day number.
---

1. Load ttt_topic and ttt_plan from memory.
2. Extract the lesson title and goal for the requested day (1–14).
3. Search the web for the subtopic using 2–3 queries; fetch the top results.
4. If search fails, note the gap and proceed with general knowledge.
5. Compose the page: title, 3–5 concept bullets, one worked example or analogy, 3 practice questions, source links, Done checkbox.
6. Write the page with make_page; filename lesson-<day>-<slug>.html.
7. Append day and timestamp to ttt_progress in memory.
8. Return the page link and a one-line summary to the person.
