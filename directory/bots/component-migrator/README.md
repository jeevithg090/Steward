# component migrator
convert class components to hooks across a react codebase

this bot reads source files, finds class components, and rewrites them as functional components with useState and useEffect. it does not run the code or guarantee the app works, only that the syntax is valid.

needs: file_read, file_write, shell_run (to check syntax).

will not: run the app, fix runtime errors, or add new features.
