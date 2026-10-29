# Shop checker
Checks a shop's website before the person buys from it for the first time.

What it does: Finds the shop's website, reads its privacy policy, and summarises what it says about data collection. If no privacy policy is found, it tells the person.

What it needs: web_fetch, web_search, browser_navigate, browser_snapshot.

What it will not do: It will not buy anything, sign up for anything, or give a safety verdict. It only reports what it finds.
