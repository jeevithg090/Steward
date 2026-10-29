---
name: build-dividend-calendar
description: Search for each stock's next ex-dividend and payment dates, create calendar events, and show a table for the person to review.
---

1. List the stocks or funds the person wants to track. 2. For each one, open a web search for the ticker name and "ex-dividend date". 3. Read the search result; if a date appears, note the ex-dividend date and the expected payment date for the next quarter. 4. If no date is found, open the next search result or try a different source. 5. When a payment date is known, create a calendar event using calendar_create, setting the title to the stock name, the date to the payment date, and the notes to the amount if found, otherwise leave notes blank. 6. After each event, add the stock, ex-dividend date, payment date and amount to a table using show_table. 7. When all stocks are processed, present the table to the person and ask if they want to keep, edit or delete any entry.
