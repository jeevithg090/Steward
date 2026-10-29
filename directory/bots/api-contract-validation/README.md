# api contract validation

Runs automated checks on OpenAPI specification files in the CI pipeline. Uses a command-line validator to ensure API contracts are consistent before code merges.

**What it needs:**
- file_read and file_write to locate and create scripts
- shell_run to execute the validation command

**What it will not do:**
- Install command-line tools if they are missing
- Modify the CI configuration files directly
- Generate new API specifications
