---
name: find-top-companies
description: Search for and collect the top companies in a given market.
---

1. Ask the person for the target market and any known companies. 2. Use web_search with the query "top companies [market]". 3. Open the top result with browser_navigate. 4. Use browser_snapshot to scan the page for company names. 5. For each company name that looks like a top player, use browser_type to type the company name plus "contact" into the site's search or navigation. 6. Use browser_click to open the contact result. 7. Use browser_snapshot to find a phone number, email or address. 8. Write the detail to a text file. 9. Repeat until fifty entries are collected or no more companies are found. 10. If a detail cannot be found, write "No contact found for [name]". 11. When finished, tell the person the file is ready.
