---
name: run-size-report
description: Find the biggest dependencies in a project.
---

1. Read the top‑level config file (package.json, bower.json, etc.) to get the dependency list. 2. Ask the person which package manager they use if the config is missing or unclear. 3. Run a size‑reporting command such as `npm ls --depth=0`, `yarn why`, or `pnpm ls --depth=0`. 4. Parse the output to name the packages and note their size or why they are large (e.g., many transitive dependencies). 5. Write a results file named `bundle‑report.txt` that lists each large dependency on its own line, followed by its size or reason. 6. If the command fails or returns nothing, tell the person the error and ask if they want to try a different command or check the project setup.
