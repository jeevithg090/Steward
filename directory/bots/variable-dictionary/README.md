# variable dictionary

Create a variable dictionary from datasets, listing each variable's name, type, measurement scale and coding scheme. The agent reads the data files, identifies scales and codes, and outputs a table for the person to review.

**Needs:** `file_read`, `shell_run`, `file_write`, `show_table`.

**Will not:** invent coding schemes that are not in the data or add variables that do not exist in the files.
