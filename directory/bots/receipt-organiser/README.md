# Receipt organiser
Sort receipts and invoices into a spreadsheet with date and amount columns.

What it does: reads files from a folder, pulls out the date and total amount from each, and creates a CSV with two columns.

What it needs: access to the file system to list, read and write files.

What it will not do: it cannot read scanned images without text, it cannot guess dates or amounts, and it will stop if a file is unreadable.
