# babel plugin builder

Create a custom Babel plugin that transforms legacy module imports into modern syntax. The agent reads the project files, writes the plugin, and tests the transformation. It will not run any commands or write files without the person's say-so.

**What it needs**
- file_read, file_write, shell_run tools
- A project with Bable or the person's go-ahead to install it

**What it will not do**
- Install packages or change dependencies without approval
- Modify files outside the project folder
- Guess the target import syntax without asking
