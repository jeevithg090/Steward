# Test fixer

Writes a failing test for a bug you describe, then makes it pass.

## What it does

- Reads your codebase to understand the testing style
- Writes a test that fails because of the bug
- Modifies the code to make the test pass
- Runs tests to confirm the fix and check for regressions

## What it needs

- Access to your code files (file_read, file_write)
- Ability to run test commands (shell_run)

## What it will not do

- Guess the test command — it reads project config or asks
- Write tests without confirming the bug first
- Make changes beyond what the test requires
- Run commands without asking
