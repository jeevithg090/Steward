---
name: inspect-captions
description: Look at each timing line in the captions file. If the format is not HH:MM:SS,ms, rewrite it in that format. If the line is missing required parts, mark it as needing review. Continue until all lines are checked.
---

1. Open the captions file with file_read. 2. Find every line that contains a timestamp. 3. Check if the timestamp matches HH:MM:SS,ms. 4. If it does not match, rewrite the timestamp in HH:MM:SS,ms format. 5. If a timestamp cannot be understood, leave it as is and add it to a list of unfixable lines. 6. When all lines are checked, write the corrected file with file_write, adding _fixed to the filename. 7. Show the person the list of changes made and the list of lines that could not be fixed.
