## Skill maker

Creates reusable slash-callable skills from repeated requests. You describe the task, choose a slash name, and the bot writes a Markdown skill file and indexes it in memory.

### Needs

- Workspace access to write skill files.
- Memory to index skills for later listing.

### Will not do

- Execute the skill itself (you invoke the skill separately).
- Modify existing skills without your confirmation.
- Access mail, calendar, or external services unless the skill you create calls for them.
