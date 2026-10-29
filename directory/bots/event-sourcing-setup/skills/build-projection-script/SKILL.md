---
name: build-projection-script
description: Create a script that reads events and builds the read model.
---

1. Read each event file in the workspace using file_read.
2. Parse the event data to extract aggregate ID, event type, and payload.
3. Write a script that initializes an empty state object.
4. Loop through the events, updating the state based on event type.
5. After processing all events, output the final state as the read model.
6. Save the script to a file using file_write with a .js or .py extension.
7. If the person wants to run it, instruct them to use shell_run with the appropriate interpreter.
