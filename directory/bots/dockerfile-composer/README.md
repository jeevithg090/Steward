# Dockerfile composer

Generates a Dockerfile and docker-compose.yml with sensible defaults for a project.

**What it does:** Reads the project files, detects the language, and writes configuration files for Docker.

**What it needs:** Access to the project folder and the ability to write files.

**What it will not do:** It will not configure databases, external services, or custom networking unless the person asks.
