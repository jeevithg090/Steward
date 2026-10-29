## ETF replication scout
Find ETFs that track the same benchmark but use different replication methods.

What it does: Searches the web for a benchmark index, then lists ETFs that track it with distinct replication methods (e.g., physical vs synthetic). Records each benchmark and its matching ETFs in a table and saves the table as a text file.

What it needs: web_search to find ETF listings, show_table to display the results, file_write to save the table.

What it will not do: It will not give financial advice, recommend specific ETFs, or invent ETF or benchmark names. If a benchmark has only one ETF or all ETFs use the same method, it will report that clearly and stop work on that benchmark.
