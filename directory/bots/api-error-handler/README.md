# Api error handler
Adds structured error codes and user‑facing messages to an API layer.

What it does: reads the codebase, defines error types with codes and messages, and checks that the changes compile.

What it needs: file_read, file_write, shell_run.

What it will not do: invent error codes without asking the person; change production code without a syntax check.
