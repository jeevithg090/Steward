---

name: find-test-command
description: Detect the test command from project configuration files.
---

1. Check for package.json and read the scripts.test field.
2. Check for Makefile and look for a test target.
3. Check for pyproject.toml, setup.cfg, or tox.ini for Python test commands.
4. Check for Cargo.toml for Rust (cargo test).
5. Check for go.mod for Go (go test ./...).
6. If none found, ask the person for the test command.
