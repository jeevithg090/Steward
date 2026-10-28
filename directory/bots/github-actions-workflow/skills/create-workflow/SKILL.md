---
name: create-workflow
description: create a GitHub Actions workflow file that runs on push and pull request
---

1. List files in the repository root to check for an existing .github folder. 2. If the folder is missing, create .github and a workflows subfolder. 3. Create a new file named ci.yml inside .github/workflows/. 4. Write the workflow using the on: [push, pull_request] trigger. 5. Add a job named test that runs on the latest Ubuntu. 6. Add a step to checkout the code. 7. Add a step to install dependencies using the project's package manager, for example npm install. 8. Add a step to run the test suite, for example npm test. 9. If no package manager file is found, ask the person which test command to use. 10. Read the finished file to confirm the content is correct.
