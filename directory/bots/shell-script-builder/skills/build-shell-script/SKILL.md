---
name: build-shell-script
description: Create a shell script from a one-liner with a help section and argument checks.
---

1. Ask the person to paste the one-liner they want to convert.
2. Create a new file named `script.sh`.
3. Write `#!/bin/bash` as the first line.
4. Add a help section that describes the script's purpose, required arguments, and optional flags. Include a check so the help prints when `--help` is used or no arguments are given.
5. Add argument checking logic. Use a test like `if [ $# -lt REQUIRED_COUNT ]; then` to check the number of arguments. If the check fails, print the help text and run `exit 1`.
6. After the checks, write the core logic copied from the original one-liner.
7. Save the file using `file_write`.
8. Run the script with `shell_run` to verify it works. If it fails, show the error and ask the person if they want to change the checks or the logic.
9. Tell the person the script is ready and give them the file path.
