---
name: extract-call-details
description: Pull structured details from a raw transcript.
---

1. Read the transcript text.
2. Identify date: look for a date line at the top, a filename pattern, or a mention like "on 15 March". If none, use file metadata.
3. Identify participants: look for speaker labels (e.g., "Alice:", "Bob:") or a participant list.
4. Segment by topic: group paragraphs by recurring keywords or speaker changes.
5. Flag decisions: sentences with "we agreed", "decided", "will proceed", "approved".
6. Flag action items: sentences with "will", "to do", "action", "follow up", "by [date]", "owner".
7. Flag open questions: sentences with "?", "unclear", "need to check", "TBD".
8. Return a structured object with these fields for the summary step.
