# @steward/directory

The hosted half of the Steward bot directory ([docs/plans/bot-directory.md](../../docs/plans/bot-directory.md)
§3.2). One Hono process on Node with a `node:sqlite` file, MIT, self-hostable. It serves the
built `directory/` folder and adds search, an MCP connector, counts, GitHub sign-in, submissions,
claims, reports and a review page. A Steward only needs its `index.json`.

```sh
pnpm --filter @steward/directory start     # http://127.0.0.1:8790, reads .env from the repo root
pnpm --filter @steward/directory dev       # the same, restarting on changes
```

Then point a Steward at it: `STEWARD_DIRECTORY_URL=http://127.0.0.1:8790/index.json`.

The full guide for hosts (GitHub sign-in, reviewers, Docker, the API and MCP, privacy) is
[docs/directory.md](../../docs/directory.md).

## Files

| File                 | What it holds                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `src/app.ts`         | `createDirectoryApp`: every route, sign-in, CORS, rate limits, errors, `listen` and `close`.        |
| `src/catalogue.ts`   | The index and packs from the folder, counts laid over them, FTS5 search, `rebuild` (`buildIndex`).  |
| `src/mcp.ts`         | The MCP server: `find_bots`, `get_bot`, `latest`, `list_categories`, `submit_bot`.                  |
| `src/submissions.ts` | Reading a pack from GitHub, `validatePack` with the gateway's `CelEngine`, claims, approve, reject. |
| `src/github.ts`      | OAuth (no scope, token never kept) and reading a repository folder or gist.                         |
| `src/store.ts`       | The tables: installs per bot per day, votes, sessions, submissions, reports.                        |
| `src/site.ts`        | The browse site, the privacy and review pages, `feed.xml` and `llms.txt`. No scripts.               |
| `src/html.ts`        | Escaping, a small Markdown renderer for listing text, the page frame and styles.                    |
| `src/rate-limit.ts`  | A sliding window per address, in memory only.                                                       |
| `Dockerfile`         | The image: the directory and the packages it reads, nothing else.                                   |

## Tests

```sh
pnpm vitest run apps/directory
pnpm --filter @steward/directory typecheck
pnpm biome check apps/directory
```

The tests use a temporary directory of five packs and a pretend GitHub, so they never reach the
network: routes, search ranking, counts, MCP through an in-process client, sign-in, submissions
(an `allow` rule is refused), claims, review, and a check that no secret is shown or written down.
