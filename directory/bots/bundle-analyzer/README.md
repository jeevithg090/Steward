# bundle analyzer

Scans a codebase to find the biggest dependencies by bundle size.

**What it needs:**
- Reads project config files.
- Runs shell commands for the chosen package manager.
- Writes a summary file with the results.

**What it will not do:**
- It cannot install missing dependencies or change the project configuration.
- It cannot interpret why a package is large beyond what the size‑report command shows.
