# Study scout
Find and compare funding sources and conflicts of interest across research studies.

What it does: Searches the web for each study, pulls out who paid for it and who has conflicts, and puts it in a table.

What it needs: file_read to get the list of study titles, web_search to find the papers, browser_snapshot to read the pages, file_write to save the table, show_table to display the results.

What it will not do: It cannot read paywalled articles behind a sign‑in, and it will not guess funding or conflict details.
