# Async context propagation
Adds request-id propagation through async context for distributed logging.

- Reads project files and updates logger calls to include the request ID from async context.
- Runs the test suite to verify logs contain the request ID across async boundaries.
- Will not modify production configuration or deploy code.
- Needs the file_read, file_write and shell_run tools.
