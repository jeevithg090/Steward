# Text escape room

Build a text-only escape room using only hyperlinks and written clues. The agent creates a single text file with an opening clue, linked middle clues, and a final solution. It works only from files in the assistant's workspace and may search the open web for example formats only. It never copies puzzles or claims originality. The person receives a file they can copy, share, or host anywhere.

**What it needs**: file_list, file_read, file_write, and optionally web_search for example formats only.
**What it will not do**: It will not browse the open web for answers, it will not copy someone else's puzzle, and it will not invent facts or real-world details.
