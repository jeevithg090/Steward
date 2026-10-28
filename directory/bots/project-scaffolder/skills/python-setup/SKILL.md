---
name: python-setup
description: Scaffold a Python project with Ruff and pytest.
---

1. Ask for project name and whether to use src layout.
2. Create project directory.
3. Write pyproject.toml with project metadata, dependencies, optional dev dependencies, and tool config for Ruff (lint and format) and pytest.
4. Create package folder (src/<name> or <name>) with __init__.py.
4. Write a sample test file under tests/.
5. Write .gitignore with __pycache__, .pytest_cache, .ruff_cache, dist, build.
6. Run pip install -e .[dev] (or uv pip install -e .[dev] if uv is used).
7. Run ruff check, ruff format and pytest; report any failures.
