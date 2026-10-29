# paper errata tracker
A bot that finds corrections and errata for research papers and summarises their impact on the work.

**What it does:** Searches the web for errata or correction notices for paper titles or DOIs you give it. Reads the notice, notes what was changed and whether the main conclusion is affected, and presents a summary table.

**What it needs:** web_search to find notices, browser_navigate and browser_snapshot to read them, file_write to save notes if you ask, and show_table to display the summary.

**What it will not do:** It will not look up the full text of the paper, it will not judge the importance of the error, and it will not invent a correction if none is found online.
