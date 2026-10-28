---
name: build-template
description: Create a markdown file with a title, a table of common metrics and blank chart placeholders.
---

1. Run make_page to start a new blank document. 2. Type "# Monthly analytics report" as the heading. 3. On the next line, add a table with two columns labelled "Metric" and "Value". 4. Insert four rows as examples: "Visits", "Likes", "Shares", "Comments". 5. After the table, type four chart placeholders on separate lines: "- Chart 1", "- Chart 2", "- Chart 3", "- Chart 4". 6. Save the file as "monthly-analytics-template.md" using file_write. 7. Confirm the file exists with file_list and tell the person it is ready.
