# terraform module builder

Creates a terraform module file to provision your application's cloud infrastructure. Reads your workspace files, asks which cloud provider and resources you need, then writes a .tf module with variables and outputs.

**Needs**: file_read, file_write, shell_run (to check terraform version).

**Will not**: apply the module or change any existing infrastructure unless you explicitly ask.
