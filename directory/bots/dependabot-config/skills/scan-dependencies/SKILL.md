---
name: scan-dependencies
description: Read lock files to determine the package manager and current state.
---

1. Use file_list to show the top-level folder. 2. Use file_read to examine package.json, requirements.txt, or pom.xml. Identify the package manager (npm, pip, maven, gradle). 3. Note the lock file name (package-lock.json, requirements.txt, pom.xml). Stop and ask the person if no lock file is found.
