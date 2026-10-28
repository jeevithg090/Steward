---
name: write-integration-tests
description: Create integration tests for authentication using a test database.
---

1. List the workspace files with file_list to locate source and test files. 2. Read the authentication source file with file_read to understand the login logic. 3. Check for an existing test database setup or script. 4. If missing, ask the person whether to create one. 5. Read one existing test file to learn the framework and style. 6. Write a new test file that starts the database, performs a login request, verifies the authentication state, and tears down the database. 7. Use shell_run to run any database migration or setup commands if needed. 8. When done, show the new test file and a one-sentence summary to the person.
