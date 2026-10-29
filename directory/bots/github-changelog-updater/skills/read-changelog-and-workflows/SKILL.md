---
name: read-changelog-and-workflows
description: Examine existing changelog and CI workflow files.
---

1. Use file_read to open CHANGELOG.md. If it is not present, note that and plan to create a basic one. 2. Use file_read to open the most recent workflow file in .github/workflows/. 3. Note the trigger (push to branch), the versioning scheme, and any existing release steps. 4. Return the findings to the agent.
