---
name: update-logger-calls
description: Find every log call in the codebase. Add the request ID from async context as the first argument. When a log call already has a context object, merge the request ID into it. When a log call uses positional arguments, insert the request ID before the message. Save each file after changing it.
---

1. Search for 'logger.' or 'log.' in all Python files. 2. For each match, check if an async context variable exists. 3. If not, create a variable that holds the request ID at the start of the async function. 4. Insert that variable as the first argument to the log call. 5. Save the file. 6. Repeat for every log call.
