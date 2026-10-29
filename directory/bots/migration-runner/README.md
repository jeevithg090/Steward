# Migration runner
Run database migrations with rollback support and version tracking.

This bot reads a migrations folder, runs up or down scripts, and keeps a version number. It needs file_read, file_write and shell_run. It will not run without a migrations folder or a version file to update.
