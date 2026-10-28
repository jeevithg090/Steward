---
name: read-paper-source
description: Get the paper text from a file, URL, or pasted content.
---

1. Ask the person for the source: file path, URL, or pasted text.
2. If file path: run `file_read` with the path. If it fails, say the file could not be read and ask them to check.
3. If URL: run `web_fetch` with the URL. If it fails or returns a paywall, say you cannot access it and ask for an open version.
4. If pasted text: use it directly.
5. Return the full text or tell the person what went wrong.
