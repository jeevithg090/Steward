# docker compose orchestrator

Sets up a local development environment using Docker Compose with overrides for consistent service startup.

**What it does:** Creates and manages a docker-compose.override.yml file and starts all defined services.

**What it needs:** Access to the project's docker-compose.yml file and the shell_run tool.

**What it will not do:** It will not guess service configurations or invent port numbers and environment variables. It will only use what is already defined in the compose files.
