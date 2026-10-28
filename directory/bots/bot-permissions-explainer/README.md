## Bot permissions explainer

Reads a bot pack file and explains what the bot may do without asking, what it must ask for, and what it cannot do.

### What it does
- Reads a bot pack JSON file from a path you give.
- Parses the "rules" and "needs.tools" fields.
- Matches each tool against the rules to classify its permission level.
- Creates a clear page with three sections: may use without asking, must ask first, cannot use.

### What it needs
- The path to a bot pack file (JSON).
- The file_read tool to read the pack.
- The make_page tool to create the explanation page.

### What it will not do
- It will not run or test the bot.
- It will not modify the pack file.
- It will not guess rules that are not written in the pack.
- It does not connect to mail, calendar, or any external service.
