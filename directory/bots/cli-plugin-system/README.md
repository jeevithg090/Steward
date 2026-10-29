# cli plugin system

Sets up a plugin architecture with dynamic loading and dependency injection for the CLI.

**What it does:** Discovers plugins from a directory, loads them dynamically, and injects required services at runtime.

**What it needs:** file_read, file_write, shell_run to create and modify plugin files and scripts.

**What it will not do:** It will not auto-generate production-ready packaging or publish plugins to external registries.
