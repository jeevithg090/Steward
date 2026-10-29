---
name: read-nutrition-labels
description: "Search the web for a product's nutrition label. Read the page and locate the total carbohydrate grams and the fibre grams. Subtract the fibre grams from the total carbohydrate grams to find net carbs. If sugar alcohols are listed, note which ones are present and apply the usual rule: subtract half the grams of sugar alcohols that affect blood sugar, leave the rest. Present the calculation as 'Total carbs Xg, fibre Yg, net carbs Zg per serving.' If the label cannot be found, say so plainly and ask if another product should be tried."
---

1. Use web_search with the product name and 'nutrition label'. 2. Use web_fetch to read the search result page. 3. Scan the page for a nutrition label or table. 4. Find the line labelled 'Carbohydrates' or 'Total Carbohydrate' and note the grams per serving. 5. Find the line labelled 'Fibre' or 'Fiber' and note those grams. 6. Calculate net carbs = total carbs - fibre. 7. If sugar alcohols appear, subtract half their grams from the total before subtracting fibre, or note them separately. 8. Write the result on a make_page with the product name, total carbs, fibre and net carbs.
