---

name: parse-notes-to-cards
description: Turn raw note text into question-answer flashcards.
---

1. Read the full note text.
2. Look for explicit Q&A markers (e.g., 'Q:', 'A:', 'Question:', 'Answer:').
3. If markers exist, split each pair into a card.
4. If no markers, split by headings (#, ##) or bullet points; treat the heading as the question and the body as the answer.
5. If still no structure, return an empty list and tell the agent to ask the person for a structured format.
6. Return a list of {question, answer} objects.
