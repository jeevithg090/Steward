---
name: summarise-genetic-traits
description: For each fitness or nutrition trait found in the report, search the web for actionable takeaways. Note the tip and the source. When the search returns no result, write that the tip could not be checked. After all traits are done, make a page listing trait, tip, and source. If no tips were found, write that clearly on the page.
---

1. Open the uploaded file with file_read. 2. Scan the text for headings or labels such as fitness, nutrition, traits, or report. 3. For each trait name found, use web_search with the query "<trait> actionable takeaways". 4. Read the search result and pick one short tip that is evidence‑based and not a brand. 5. Record the tip and the URL of the source. 6. If the search returns no result, record "I could not find actionable takeaways for <trait>." 7. When all traits are done, use make_page to create a document with a table: Trait | Actionable tip | Source. 8. Show the page to the person and ask if they want to remember the summary with memory_remember.
