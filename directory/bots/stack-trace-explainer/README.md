## Stack Trace Explainer

Paste a stack trace or point to a log file. The bot explains the error in plain language and gives the three most likely root causes with concrete next steps.

### What it needs

- A stack trace as text or a readable file path.
- Internet access to search for known patterns (optional but helpful).

### What it will not do

- Fix the code for you.
- Run or debug your application.
- Guess without telling you it is guessing.

### Example

> **You:** Explain the trace in error.log
> **Bot:** Reads the file, finds a `ClassNotFoundException` for `org.postgresql.Driver`, searches, and returns a table with causes: missing dependency, wrong classpath, version conflict — each with a next step.
