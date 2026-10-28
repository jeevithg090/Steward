# OpenAPI spec generator

Generate an OpenAPI specification from the route handlers in a codebase.

What it does: Reads source files, finds route handlers, and produces an OpenAPI YAML or JSON document.

What it needs: Access to the codebase files via file_list, file_read, and file_write.

What it will not do: It cannot interpret business logic or generate documentation beyond the route structure and schemas found in the code.
