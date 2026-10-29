# git hook guard
prevents commits that contain console.log or debugger statements

creates or updates a git pre-commit hook that searches staged files for console.log or debugger before allowing a commit. if the patterns are found the commit is aborted. the hook script is shown at the end so the person can review it.
