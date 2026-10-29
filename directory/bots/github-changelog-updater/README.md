# GitHub Changelog Updater
This bot pack creates a GitHub Action that automatically updates the CHANGELOG.md file and prepares a release draft after each commit. It reads the repository's current format, writes a new workflow file, and commits the changes. The person reviews the files before they are pushed.

**What it needs:** read and write access to the repository's files via file_read and file_write, and the ability to run shell commands with shell_run.

**What it will not do:** it will not push anything to GitHub without the person's okay, it will not guess commit messages or release tags, and it will not modify any existing workflows without asking first.
