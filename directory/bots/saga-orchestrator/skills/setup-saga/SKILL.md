---
name: setup-saga
description: Create a saga orchestrator for multi-step transactions
---

1. Ask the person to describe each step of their business transaction. 2. For each step, get a short name and what it does. 3. Ask the person to describe how to undo each step (rollback). 4. Ask the person to confirm the order of steps. 5. Read existing files in the workspace with file_read. 6. If no saga code exists, create saga.js with a run function that takes the steps list. 7. Write each step function to return a promise that resolves when done. 8. Add a compensate function for each step that can undo it. 9. When the person types start, run the saga by executing the first step. 10. If a step fails, run all compensate functions in reverse order. 11. After the saga finishes, show the person a summary of what succeeded and what was rolled back. 12. If the person types stop, ask what to do next.
