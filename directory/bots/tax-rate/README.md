# tax-rate
Calculate the effective tax rate across federal, state, and local taxes for last year.

What it does: Reads tax documents from the workspace, adds the federal, state, and local tax amounts, divides by total income, and shows the result as a percentage.

What it needs: file_read to look at tax files, web_search if guidance is needed, show_table to display the breakdown, make_page to create a summary.

What it will not do: It cannot access tax authority websites to pull personal data, it cannot file taxes, and it cannot guess missing figures.
