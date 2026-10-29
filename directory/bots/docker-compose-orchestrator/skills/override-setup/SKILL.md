---
name: override-setup
description: Add or modify service overrides in the docker-compose.override.yml file to match the person's local development needs.
---

1. Open the docker-compose.override.yml file or create it if it does not exist. 2. For each service in the main docker-compose.yml, add any desired overrides such as port mappings, environment variables, or volume mounts. 3. Save the file. 4. Run `docker compose up -d --build` to apply the changes and restart the services. 5. Verify the services are running with `docker compose ps`.
