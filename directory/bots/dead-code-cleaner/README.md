# dead-code-cleaner
Scans codebase packages to find and remove unused exports.

What it does: collects named exports from every source file, checks which are imported elsewhere, and removes those never used.

What it needs: file_read, file_write, shell_run to read and modify source files.

What it will not do: it cannot fix syntax errors introduced by removal, and it will not change default exports or re-exports without explicit confirmation.
