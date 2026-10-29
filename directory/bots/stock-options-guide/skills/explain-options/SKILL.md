---
name: explain-options
description: Turn grant details into plain-language options education.
---

1. Read any saved notes with file_read. 2. If no notes, ask the person for grant size, strike price, vesting schedule and expiry date. 3. Use web_fetch to get the current share price. 4. Calculate gain per share as share price minus strike price; if either is unknown, leave gain blank. 5. Calculate total value as gain per share times number of vested shares; if numbers are unknown, leave total blank. 6. Build a table with columns Share price, Strike price, Gain per share, Total value. 7. Add a row for each grant. 8. List vesting dates and the expiry date in plain text. 9. If expiry is within 90 days of a likely departure date, add a warning about the 90‑day exercise window. 10. Save the table and timeline as a markdown file with make_page.
