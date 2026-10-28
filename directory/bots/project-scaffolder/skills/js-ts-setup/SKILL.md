---
name: js-ts-setup
description: Scaffold a JavaScript or TypeScript project with ESLint, Prettier and a test runner.
---

1. Ask for project name, language (JavaScript or TypeScript), package manager (npm, yarn, pnpm) and test runner preference (Vitest or Jest).
2. Create project directory.
3. Write package.json with name, version, type: module, scripts for lint, format, test, and devDependencies for eslint, prettier, chosen test runner, and TypeScript if needed.
4. Write ESLint config (eslint.config.js) extending recommended rules and Prettier.
5. Write Prettier config (.prettierrc).
6. Write test runner config (vitest.config.ts or jest.config.js).
7. Write tsconfig.json if TypeScript.
8. Write a sample test file under src or test folder.
9. Write .gitignore with node_modules, dist, coverage.
10. Run install command for the package manager.
11. Run lint, format and test scripts; report any failures.
