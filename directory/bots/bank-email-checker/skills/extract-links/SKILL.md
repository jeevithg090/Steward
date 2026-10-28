---

name: extract-links
description: Pull every http/https link from an email body with visible text and href.
---

1. Read the plain-text and HTML bodies.
2. Use a simple regex to find all <a href="..."> in HTML and bare URLs in text.
3. For each, record the visible link text (or "[no text]") and the target URL.
4. Deduplicate by target URL.
5. Return the list.
