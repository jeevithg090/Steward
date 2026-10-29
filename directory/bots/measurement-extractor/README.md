# measurement extractor
Extracts measurement instruments and their psychometric properties from research studies.

**What it does:** Reads a study file, searches the web for each instrument, and reports its reliability and validity.

**What it needs:** file_read to open the study, web_search and browser_snapshot to look up instruments, file_write to save results, show_table to display them.

**What it will not do:** It cannot access paywalled databases or proprietary survey tools. It will mark any property as "not reported" if the web search finds no information.
