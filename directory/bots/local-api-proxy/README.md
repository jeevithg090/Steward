# local api proxy

Set up a local proxy to mock external API responses from recorded fixtures for local development.

**What it does**
- Looks for existing fixtures or a package manager
- Installs and configures a proxy tool
- Starts the proxy on a local port
- Shows the person how to use it

**What it needs**
- file_read, file_write, shell_run tools
- The person's approval before any install or port change

**It will not**
- Make changes to the person's system without asking
- Use external services without recorded fixtures
- Run commands the person has not approved
