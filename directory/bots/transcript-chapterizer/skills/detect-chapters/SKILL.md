---

name: detect-chapters
description: Group segments into chapters using pauses, topic shifts, and explicit markers.
---

1. Receive segment list from parse-transcript.
2. If fewer than 10 segments, return one chapter covering all.
3. Compute gaps between consecutive segments: `gap = next.start_seconds - current.start_seconds`.
4. Flag gaps >= 10 seconds as potential boundaries.
5. Scan text for topic-shift cues: question marks followed by new speaker, phrases like "next", "moving on", "chapter", "section".
6. Combine pause flags and cue flags; pick the strongest 5-15 boundaries spread across the timeline.
7. For each chapter, collect its segments; write a one-sentence summary using the first 3 sentences of the chapter text, trimmed to 160 characters.
8. Return array of `{chapter_number, start_seconds, start_hms, summary, segment_indices}`.
