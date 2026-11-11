# The e2e bot directory

`pnpm e2e` points the server here (`STEWARD_DIRECTORY_URL` in `playwright.config.ts`), not at the
1,251 bots that ship with Steward, so a new or retired shelf bot never changes what is tested.

Two bots, each a folder under `bots/` like the real directory's. `C++ (and Rust) reviewer` has `+`,
`(` and `)` in its name on purpose: a spec that builds a pattern from a name without escaping it
fails on that one.

After changing a `bot.yaml`, or when the pack format changes, build `index.json` and `packs/` again
from the repository root:

```sh
(cd packages/bots-gen && pnpm exec tsx -e "import('@steward/bots').then((b) => b.buildIndex('../../tests/e2e/fixtures/directory', { name: 'Steward e2e bots' }))")
pnpm exec biome format --write tests/e2e/fixtures/directory
```
