# Customer log
Record every chat so the next one feels fresh, not repeated.

What it does: writes a date‑stamped note to a log file after each customer conversation. The note includes who was talking, what was said, and any follow‑up. The person can ask about past chats and the assistant will search the log.

What it needs: memory_remember to keep the person's name in mind, file_write to save the log.

What it will not do: it will not share the log with anyone else, it will not guess names that were not given, and it will not create entries without a topic.
