# Bot safety reviewer

Reviews a bot pack and proposes guard-rail rules that keep the bot useful while limiting risky actions.

## What it does
- Reads a bot pack (file or pasted JSON).
- Maps every tool, connector and instruction to the official rule triggers.
- Proposes new `rules` entries (ask or deny) for any risky capability that lacks one.
- Returns a Markdown page with a comparison table and the updated JSON ready to copy.

## What it needs
- The bot pack JSON (path or pasted).
- Workspace access to read/write files.

## What it will not do
- Invent new trigger values outside the official list.
- Add rules for capabilities the bot does not have.
- Modify the pack's core instructions or tools.
