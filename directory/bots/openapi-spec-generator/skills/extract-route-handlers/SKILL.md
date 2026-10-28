---
name: extract-route-handlers
description: Find and record route handlers from source files
---

1. Open each file from the file list. 2. Search for function definitions or decorators that indicate an HTTP route, such as @app.get, @router.post, or similar patterns. 3. For each route found, note the path, the HTTP method, and any request body or response type mentioned in comments or type annotations. 4. If the language uses annotations or attributes to define the route, read those to extract the path and methods. 5. Skip functions that do not handle HTTP requests. 6. Continue until all files are checked. 7. If a file cannot be read, record that it could not be accessed and move on.
