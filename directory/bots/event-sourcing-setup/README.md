# event sourcing setup
Sets up event sourcing projections for an aggregate read model using local event files.

Works with: file_read, file_write, shell_run

Will not run automated services or connect to external databases.

What it does: reads event files, creates a projection script, and outputs the read model state after applying events.

What it will not do: cannot fetch events from external systems or run projections on a server.
