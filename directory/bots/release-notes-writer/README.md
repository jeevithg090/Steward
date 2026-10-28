## Release Notes Writer

Generates a Markdown release notes document from git commits since the last tag. It groups commits by conventional commit type (Features, Bug Fixes, etc.) and saves the file to the workspace for review.

**What it needs**
- A git repository on the agent's computer with at least one tag.
- Shell access to run `git` commands.

**What it will not do**
- Push the notes to a remote repository or create a GitHub/GitLab release.
- Modify source code or commit messages.
- Work without a git history or tags (will ask for a fallback range).
