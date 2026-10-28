## Call summariser

Reads a call transcript file from the workspace and produces a concise summary page with:
- Overview of the call
- Decisions made
- Action items with owners and due dates
- Open questions

Optionally creates follow-up tasks for each action item.

### Needs
- A transcript file in the workspace (text, markdown, or similar).
- The person tells the bot which file to use.

### Will not do
- Join live calls or record audio.
- Access external CRM systems.
- Guess missing owners or dates; it will ask instead.
- Send the summary anywhere; it saves a page in the workspace for the person to share.
