---
name: parse-bot-pack
description: Read and parse a bot pack JSON file from a given path.
---

1. Receive a file path from the person.
2. Use file_read to read the file.
3. If the file does not exist, return an error message.
4. Parse the content as JSON.
5. If parsing fails, return an error message.
6. Return the parsed pack object.
