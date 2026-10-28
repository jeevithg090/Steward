---
name: write-dependabot-config
description: Create or update dependabot.yml with security update settings.
---

1. If a dependabot.yml already exists, read it with file_read. 2. If it exists, ask the person whether to merge or replace. 3. If new or replacing, write a dependabot.yml that sets package-ecosystem to the detected manager, directory to the lock file location, schedule.interval to "daily", and enables open-pull-requests and security-updates. 4. Save the file with file_write. 5. Show the finished file to the person.
