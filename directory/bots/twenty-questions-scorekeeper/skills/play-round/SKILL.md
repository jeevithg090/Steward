---
name: play-round
description: Run one round of Twenty Questions and update the weekly score.
---

1. Ask the person to think of a thing and say ready.
2. Initialise question_count to 0.
3. While question_count < 20:
   a. Ask a yes/no question.
   b. Increment question_count.
   c. If the answer lets you guess, make a guess.
   d. If guess is correct, record bot win; else record person win.
   e. Break loop.
4. If 20 questions reached without correct guess, record person win.
5. Load or initialise weekly score fact for current Monday.
6. Increment bot_wins or person_wins.
7. Save updated fact via memory_remember.
8. Report result and current weekly score.
