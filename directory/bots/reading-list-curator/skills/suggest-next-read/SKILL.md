---
name: suggest-next-read
description: Generate tailored book recommendations based on reading history.
---

1. Retrieve finished books from memory.
2. If fewer than 3, say more history is needed and ask them to log more books.
3. Identify patterns in authors, genres, themes, and high ratings.
4. Use web_search for queries like "books similar to [title] by [author]" or "best [genre] books if you liked [title]".
5. Filter out books already in finished or to-read lists.
6. Present 3 suggestions with title, author, description, and match reason.
7. Ask which to add to to-read list.
8. Add chosen books via memory_remember.
