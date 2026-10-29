# table partitioner
Creates a database migration that partitions a large table by date to improve query performance.

What it does: reads the migration folder, generates a new partition migration file, and runs it.
What it needs: file_read, file_write, shell_run.
What it will not do: it cannot partition tables on unsupported engines or run commands without confirmation.
