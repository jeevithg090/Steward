# OpenAPI validator

Adds middleware that validates incoming request payloads against an OpenAPI specification and rejects invalid ones before handlers run.

**What it needs**
- Reads and writes project files
- Runs shell commands to install packages

**What it will not do**
- Generate or modify the OpenAPI specification itself
- Handle authentication or authorization logic beyond payload validation
