---
name: run-contract-validation
description: Check for OpenAPI spec files in the repository root and any configured directories. Use a CLI tool like spectral or openapi-cli to validate each file against the defined rules. Capture the tool's output and exit code. If the exit code indicates errors, print the error messages in a clear format. If no spec files are found, inform the person. If the CLI tool is missing, inform the person. Return the list of files validated and any issues discovered.
---

1. List files matching '*.yaml' or '*.yml' in the repo root and any spec folders. 2. For each file, run the validation command with the file path as an argument. 3. Collect the stdout and stderr output. 4. If the command exits with a non-zero code, display the errors found. 5. If no files are found, say so and stop. 6. If the command is not found, say so and stop. 7. Return the summary of results to the person.
