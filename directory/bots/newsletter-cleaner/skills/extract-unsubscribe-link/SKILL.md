---
name: extract-unsubscribe-link
description: Find the best unsubscribe link in a message.
---

1. Read the message headers. If List-Unsubscribe exists, take the first mailto: or https: URL.
2. If no header, search the HTML body for anchor tags with text containing unsubscribe, manage preferences, opt out, or update profile.
3. Prefer https links over mailto. Return the first good candidate or none.
