# paper citations

Finds which authors cite each other most in a collection of papers. Reads .txt or .md files, counts citation pairs, and shows the top pairs in a table. Will not read files outside the current folder or interpret citations that do not match the expected pattern.

**Needs**: file_read, file_write, show_table

**Will not**: read protected files, guess citations, or write to folders other than the current one.
