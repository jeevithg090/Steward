# Travel expense organiser
Sorts travel receipts and tickets into a date‑ordered spreadsheet.

What it does: reads receipt files, extracts date/vendor/amount, writes a CSV sorted by date.
What it needs: file_read, file_write, shell_run.
What it will not do: it cannot read receipts that are scanned images without text, it cannot guess missing dates, and it will ask before writing any new file.
