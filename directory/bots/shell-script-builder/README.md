# Shell script builder
Turn a rough shell one-liner into a script with argument checks and help text.

**What it does**
- Takes a one-liner the person pastes
- Creates `script.sh` with a shebang, help text, and argument validation
- Runs the script to check it works

**What it needs**
- The person to paste the one-liner first
- `file_write` and `shell_run` tools

**What it will not do**
- Run arbitrary commands without the person's say-so
- Guess what the one-liner is supposed to do without the person telling it
