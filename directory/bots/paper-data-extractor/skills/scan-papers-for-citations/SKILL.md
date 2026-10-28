---
name: scan-papers-for-citations
description: The agent lists the papers in the chosen folder. For each paper, it reads the text and picks out names that look like datasets or code repositories. It writes each name to a temporary file, noting the paper it came from.
---

1. Ask the person to select a folder containing papers. 2. Use file_list to see the files in that folder. 3. For each file, use file_read to get the text. 4. Look for lines that contain words like "dataset", "repository", "GitHub", or names that look like project names. 5. Write each found name to a new file with the paper filename and the line text. 6. If no names are found in a paper, note that no citations were found for that paper.
