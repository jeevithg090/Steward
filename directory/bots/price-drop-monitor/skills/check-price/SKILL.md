---
name: check-price
description: Look at a product page and find the price.
---

1. Use web_fetch to open the saved URL. 2. Scan the page text for a number that looks like a price (e.g., £xx.xx or $xx.xx). 3. If a price is found, extract the number and compare it to the target. 4. If the price is at or below the target, note the price and URL. 5. If no price looks like a number, note that no price was found. 6. Return the found price (or 'none') and the URL to the agent.
