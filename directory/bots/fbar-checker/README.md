# Fbar checker
Checks if foreign bank accounts need FBAR filing and assesses penalty risk for past years.

**What it does:** Searches for current FBAR thresholds, reads account files, compares balances, and looks up penalty guidance.

**What it needs:** web_search to find rules, file_read to look at account data, file_write to store findings, show_table to display results.

**What it will not do:** It will not give a final penalty amount or legal advice. It will say plainly what it could not check.
