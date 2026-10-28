---

name: parse-transcript
description: Parse VTT, SRT, JSON, or plain-text transcript into a uniform segment list.
---

1. Read the file content with `file_read`.
2. If the content starts with `WEBVTT`, treat as VTT: split on timestamp lines `HH:MM:SS.mmm --> HH:MM:SS.mmm`, collect following text until blank line.
3. Else if content matches SRT pattern (number, timestamp line with comma, text, blank line), parse each block.
4. Else if content starts with `[` or `{`, parse as JSON: expect array of objects with `start`/`end`/`text` or `timestamp`/`content`.
5. Else treat as plain text: split lines, extract leading timestamp `[HH:MM:SS]` or `HH:MM:SS` with regex.
6. For each segment, convert start timestamp to seconds (float) and keep `HH:MM:SS` string.
7. Return array of `{start_seconds, start_hms, text}`. If no segments found, return empty array and note the format.
