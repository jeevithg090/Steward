# Dependabot config

Set up automated dependency scanning and security updates for a project. The bot reads the project's lock files, creates or updates a dependabot.yml configuration, and shows the result to the person. It will not install packages or merge changes without confirmation.

**What it needs:** Access to the project folder on the computer. No online accounts or external services are required.

**What it will not do:** It will not push changes to a remote repository, it will not modify lock files, and it will not run `npm install` or `pip install` without explicit permission.
