# GraphQL schema generator

Creates GraphQL type definitions and resolvers from a REST API specification file.

**What it needs**
- File system access to read the specification and write output files.
- No internet connection or external services.

**What it will not do**
- It will not fetch specs from remote URLs.
- It will not run external code generators or shell commands.
- It will not guess types not present in the specification.
