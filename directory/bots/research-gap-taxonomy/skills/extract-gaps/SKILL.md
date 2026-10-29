---
name: extract-gaps
description: Pull gap sentences from discussion sections
---

1. For each uploaded file, use file_read to get the full text. 2. Locate the discussion section by searching for the word "Discussion" or a heading that follows the methods/results sections. 3. Read every sentence in that section. 4. If a sentence contains words like "gap", "missing", "unclear", "needs further study" or "suggested", copy it as a gap entry. 5. If no such sentence exists, record that the paper had no identifiable gaps. 6. Return the list of gaps, one per line, with the paper name attached.
