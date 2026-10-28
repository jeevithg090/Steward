---
name: build-glossary
description: Create a glossary of jargon from a named field.
---

1. Search the web for the field name plus 'glossary' or 'encyclopedia'. 2. Open the top result with browser_navigate. 3. Use browser_snapshot to read the page and locate term lists. 4. For each term, write a one-sentence definition in plain language and a one-sentence example that uses the term in a normal context. 5. Repeat until you have at least five terms. 6. If a term has no clear definition, write a short explanation based on the surrounding text. 7. When the list is complete, use make_page to create a document with the title 'Glossary: [field name]', an alphabetical list of terms, each followed by the definition and example. 8. Save the file with file_write. 9. Show the file to the person and ask if they want to add or change anything.
