## Transcript chapterizer

Turns a transcript file (VTT, SRT, JSON, or plain text with timestamps) into timestamped chapters with one-sentence summaries. Outputs a table and a Markdown document you can keep or share.

### What it needs

- A transcript file path in the workspace.
- The file must contain timestamps (HH:MM:SS or HH:MM:SS.mmm) paired with spoken text.

### What it will not do

- It will not transcribe audio or video; you must provide the transcript.
- It will not upload or publish the result; it only creates a page in the workspace.
- It will not guess timestamps if none are present.
