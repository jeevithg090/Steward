# feature flag engine
Build a feature flag system with percentage rollout and user targeting rules.

What it does: stores flag definitions in a JSON file, evaluates flags based on rollout percentage and targeting rules, and provides a simple test script.

What it needs: file_read, file_write, shell_run to create and test the flag configuration.

What it will not do: it does not connect to remote services or manage live deployments; it only works with local files.
