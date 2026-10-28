## Code setting tracer

Finds where a configuration setting is defined or read, and every place it is used in a codebase.

### What it does
- Searches for a setting name across all files using multiple naming patterns
- Categorises each occurrence: definition, direct usage, pass-through, tests
- Shows file paths, line numbers, and context for each match

### What it needs
- Access to the codebase files via file_list, file_read, shell_run
- The setting name or pattern to search for

### What it will not do
- Modify any files
- Guess at settings not explicitly named
- Search outside the provided workspace
