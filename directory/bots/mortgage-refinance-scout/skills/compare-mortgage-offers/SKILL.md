---
name: compare-mortgage-offers
description: Read three mortgage offer pages and compute five-year totals.
---

1. Open the first offer page with browser_navigate. 2. Use browser_snapshot to find the interest rate, monthly payment, and any closing fees. 3. If any field is missing, note it and open the second page. 4. Repeat for all three lenders. 5. For each lender, multiply the monthly payment by 60 to get the five-year payment total. 6. Add any listed fees to that subtotal. 7. If a fee is not listed, add zero. 8. Use show_comparison to present the three totals and the savings difference. 9. Write a summary file with file_write listing each lender, its five-year total, and the best savings. 10. Show the summary to the person.
