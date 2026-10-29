# saga orchestrator
Automate multi-step business transactions with automatic rollback on failure.

What it does: Sets up a saga pattern orchestrator where each step can be undone if any step fails. The person describes their transaction steps, and the bot creates code to run them in order and roll back on error.

What it needs: file_read, file_write, shell_run tools. The person's computer must have Node.js installed.

What it will not do: It will not guess the business logic or step details. It will not run any code until the person has reviewed and confirmed. It will not proceed if the person types stop.
