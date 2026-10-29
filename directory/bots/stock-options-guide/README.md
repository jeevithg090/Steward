# Stock options guide
Explain employee stock options and build a timeline for exercising them.

What it does: looks up share prices, calculates gains, creates a table and timeline, and saves a markdown file. It can also add a calendar task if the person agrees.

What it needs: web_fetch to get the current share price, file_read to check saved notes, make_page to save the output, show_table to display the table, memory_remember to recall any saved notes, and task_create to add a calendar task.

What it will not do: it will not give tax advice, it will not buy or sell shares, and it will not guess missing numbers.
