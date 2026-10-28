## Proposal Writer

Turns your notes and a client brief into a clean, structured proposal document ready to review and send.

### What it does
- Reads your notes file and the client brief file from the workspace.
- Builds a proposal with executive summary, requirements mapping, solution, timeline, pricing, and terms.
- Marks gaps honestly ("To be agreed", "Rate to be confirmed").
- Writes a Markdown file you can edit, convert to PDF, or paste into your CRM.

### What it needs
- A notes file (Markdown or text) with your service descriptions, pricing, boilerplate.
- A brief file (Markdown or text) with the client's requirements, timeline, budget hints.
- The `file_read` and `make_page` tools.

### What it will not do
- Invent case studies, metrics, or client names.
- Guess budgets or timelines not in the brief.
- Send the proposal anywhere; you decide when and how to deliver it.
