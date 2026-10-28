---
name: extract-citations
description: pull author-year pairs from paper text
---

1. Open the first file. 2. Scan every line for a pattern that looks like a citation: a name, then a space, then a four-digit year in parentheses, or a name inside square brackets followed by a year. 3. Write down the author name and the year on a temporary list. 4. Close the file and move to the next one. 5. Repeat until every file is scanned. 6. If a line does not match the pattern, ignore it. 7. When all files are done, count how many times each author cites each other author. 8. Sort the pairs by count, highest first. 9. Prepare a table with the top 10 pairs and their counts.
