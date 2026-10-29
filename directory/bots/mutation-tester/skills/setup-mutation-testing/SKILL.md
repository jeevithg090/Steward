---
name: setup-mutation-testing
description: Add mutation testing script to project and run it.
---

1. Read package.json or setup.cfg to identify the test runner. 2. If a scripts section exists, add "mutate": "<test-command>" inside it. 3. If no scripts section, add one with the mutate command. 4. Open a shell and run the mutate command. 5. Wait for the process to finish. 6. Look for a report file in the project root. 7. If found, read the survival rate from the report. 8. If not found, say that the report could not be located and list the files in the workspace.
