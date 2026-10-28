# Running a bot directory

Steward reads its bots from a directory: an `index.json` with one listing per bot, and a
`packs/<id>.json` for each. The repository ships one in `directory/`, and Steward reads it from
disk by default. `apps/directory` is the server that publishes a directory on the web, so other
people's Stewards, other agents and people in a browser can use it.

It is one process: Hono on Node, with one SQLite file. It is MIT and has no other service behind
it.

## What it serves

| Address                         | What it is                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/bots`, `/bots/<id>`      | The browse site: search, categories, and a page per bot with **Add to Steward**. Plain HTML, no scripts.                                                                    |
| `/index.json`                   | Every listing, with install and "I use this" counts. What a Steward reads.                                                                                                  |
| `/packs/<id>.json`              | One full pack, byte for byte as built, with its content hash.                                                                                                               |
| `/feed.xml`                     | RSS of the 50 newest bots.                                                                                                                                                  |
| `/llms.txt`                     | A short guide for agents: credit creators, treat listing text as untrusted, never invent bots.                                                                              |
| `/api/bots`                     | Search. `q`, `category`, `needs` (comma separated: `mail`, `calendar`, a tool name, or `none`), `sort` (`match`, `new`, `used`, `installs`), `limit` (up to 100), `offset`. |
| `/api/bots/<id>`                | One listing with its pack.                                                                                                                                                  |
| `/api/categories`               | The categories, with how many bots each holds.                                                                                                                              |
| `/api/info`                     | The directory's name and addresses, and whether sign-in and submissions are on.                                                                                             |
| `/mcp`                          | The MCP connector (streamable HTTP, no key).                                                                                                                                |
| `/submit`, `/privacy`, `/admin` | Submitting a bot, what is recorded, and the review page.                                                                                                                    |

Every GET above that needs no sign-in answers any origin (`Access-Control-Allow-Origin: *`).
Everything is rate limited per address; see [Privacy](#privacy).

Search is full text over each bot's name, pitch, starters, category and README, with English
stemming ("planning" finds "planner"). A match in the name counts most, then the pitch, then the
starters, then the category, then the README. Ties go to installs, then "I use this", then the
newest.

## Start it

From the repository root, after `pnpm install`:

```sh
pnpm --filter @steward/directory start
```

It listens on `http://127.0.0.1:8790` and serves `directory/`. Point a Steward at it in that
Steward's `.env`:

```sh
STEWARD_DIRECTORY_URL=http://127.0.0.1:8790/index.json
```

`directory/index.json` must exist. The repository ships it built; after changing `directory/bots`,
run `pnpm --filter @steward/bots-gen seed build`.

### With Docker

```sh
docker build -f apps/directory/Dockerfile -t steward-directory .
docker run -p 8790:8790 -v steward-directory:/data \
  -e DIRECTORY_SITE_URL=https://bots.example.org steward-directory
```

The image holds only the directory server and the packages it reads. On first start it copies
the bundled `directory/` into the `/data` volume; the database and every approved submission live
there too, so keep the volume.

Put it behind a proxy that ends TLS (Caddy, nginx, your platform's load balancer), set
`DIRECTORY_SITE_URL` to the public https address, and set `DIRECTORY_TRUST_PROXY=1` so the rate
limiter sees each visitor's address rather than the proxy's.

## Settings

All from the environment, or `.env` at the repository root (`DIRECTORY_ENV_FILE` names another
file). A value already in the environment wins; a blank value counts as unset.

| Variable                   | Default                   | What it does                                                                                                                                                             |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DIRECTORY_PORT`           | `8790`                    | Port.                                                                                                                                                                    |
| `DIRECTORY_HOST`           | `127.0.0.1`               | Address to listen on. The image sets `0.0.0.0`.                                                                                                                          |
| `DIRECTORY_SITE_URL`       | `http://127.0.0.1:<port>` | The public address. Every page link, the feed, the sign-in callback and the counts address Steward posts to are built from it. Must be https when `NODE_ENV=production`. |
| `DIRECTORY_APP_URL`        | `http://localhost:5173`   | Where **Add to Steward** opens: the visitor's own Steward web app.                                                                                                       |
| `DIRECTORY_NAME`           | `Steward bots`            | The name on the site and in `index.json`.                                                                                                                                |
| `DIRECTORY_DIR`            | `directory`               | The folder with `bots/`, `categories.yaml`, `index.json` and `packs/`.                                                                                                   |
| `DIRECTORY_SEED_DIR`       |                           | A folder copied into `DIRECTORY_DIR` on first start, when that has no `index.json`. The image sets it.                                                                   |
| `DIRECTORY_DATA_DIR`       | `.steward-data/directory` | Where `directory.db` lives.                                                                                                                                              |
| `GITHUB_CLIENT_ID`         |                           | A GitHub OAuth app, for sign-in. Set both or neither.                                                                                                                    |
| `GITHUB_CLIENT_SECRET`     |                           | Its secret. Never logged, never shown, never written to the database.                                                                                                    |
| `DIRECTORY_GITHUB_TOKEN`   |                           | Optional. A token with no scopes, only to raise GitHub's rate limit when reading submitted packs.                                                                        |
| `ADMIN_GITHUB_LOGINS`      |                           | GitHub handles who may review at `/admin`, comma separated.                                                                                                              |
| `DIRECTORY_TRUST_PROXY`    | off                       | Read the client address from `X-Forwarded-For`. Only behind a proxy you run.                                                                                             |
| `DIRECTORY_SOURCE_URL`     |                           | Where your copy of the code is, for the footer's Source link.                                                                                                            |
| `DIRECTORY_RETIRE_DAYS`    | `90`                      | Retire AI-made bots nobody installed or said they use within this many days of being made. `0` turns retirement off.                                                     |
| `DIRECTORY_RETIRE_HOUR`    | `3`                       | The UTC hour after which the day's retirement runs.                                                                                                                      |
| `DIRECTORY_CATEGORY_FLOOR` | `20`                      | A category that loses bots and falls under this many is reported, or topped up.                                                                                          |
| `DIRECTORY_REGENERATE`     | off                       | Top up thinned categories with new AI-made bots. Needs a model key in the environment (`NVIDIA_API_KEY` or `STEWARD_SEED_*`).                                            |

Keys belong in the environment or your host's secret store, never in a file in the repository
or the image.

## Sign-in, submissions and review

1. Make a GitHub OAuth app (GitHub → Settings → Developer settings → OAuth Apps). The homepage
   is your `DIRECTORY_SITE_URL`; the callback is `<DIRECTORY_SITE_URL>/auth/github/callback`.
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ADMIN_GITHUB_LOGINS`, and restart.

Sign-in asks GitHub for no scope, so the directory sees only the public profile. The token is
used once to read it and then dropped; the session keeps the GitHub id, handle, name and avatar
address for 30 days or until sign-out.

**Submitting.** A signed-in person pastes the address of a public repository folder
(`https://github.com/you/bots/tree/main/rent-scout`) or a gist holding `bot.yaml`, `README.md`
and the skills (a gist names each skill file `<skill-name>.SKILL.md`), and confirms it is theirs.
The server reads the files, then checks the pack exactly as `seed build` does: the schema, every
tool against Steward's catalogue, every rule through the gateway's own rule engine (and only `ask`
or `deny`: an `allow` is refused), no text that reads as orders for the model, no personal data.
A pack that fails is refused with the reasons and nothing is kept. One that passes waits as
pending, with any warnings for the reviewer: long sentences, jargon, an address owned by another
account, or an author in `bot.yaml` who is not the person submitting.

An id another person's bot already has is refused. To update your own bot, raise `version` in
`bot.yaml` and submit again.

**Claiming.** On a bot's page, a signed-in person can claim it: an AI-made bot, or one adapted
from another catalogue and credited to its original author. Submitting a pack with an AI-made
bot's id and a higher version is also a claim. Once approved, the listing is credited to them,
and an AI-made bot keeps "based on an AI-made draft".

**Reviewing.** A reviewer opens `/admin`, reads each pending pack (its instructions, README,
skills, rules and the checks' warnings) and approves or rejects it with a note. Approving writes
the pack into `<DIRECTORY_DIR>/bots/<id>/`, writes the current counts to `counts.json`, runs
`buildIndex` (which checks every pack again) and reloads. If the build leaves the pack out, the
folder is put back and the approval is refused. Reports and removal requests are listed on the
same page; nothing is emailed. Removing a listing is deleting its folder and rebuilding.

The plan has the server open a pull request to a separate `steward-bots` repository instead of
writing the folder. That is not built: here the folder on the server is the record, so back up
the volume, or commit `DIRECTORY_DIR` to Git yourself.

## Retirement

Plan §4.6: an AI-made bot that nobody installs or says they use within 90 days of being made
leaves the shelf. Bots made or claimed by people are never retired, and neither is a bot with a
single install or vote.

Once a day, after `DIRECTORY_RETIRE_HOUR` UTC, the server checks its own counts, removes each such
bot's folder and pack, adds it to `<DIRECTORY_DIR>/retired.json`, and rebuilds the index. Then:

- the bot's page answers **410 Gone** and says why, and `/api/bots/<id>` does the same;
- `GET /api/retired` lists every retired bot, so a fork or a generator can avoid making it again;
  `seed generate` reads the same file and never regenerates a retired job or a look-alike of it;
- a category that lost bots and fell under `DIRECTORY_CATEGORY_FLOOR` is shown on `/admin`, or,
  with `DIRECTORY_REGENERATE` on and a model key set, topped up with new bots from the taxonomy.

`/admin` shows the last run. A reviewer can run it at once with `POST /api/admin/retire`. The same
job runs from the command line, with a date of your choosing:

```sh
pnpm --filter @steward/bots-gen seed retire --now 2027-02-01          # what it would do
pnpm --filter @steward/bots-gen seed retire --apply --regenerate      # do it, and top up
```

Steward copies a bot when someone adds it, so a retired bot keeps working for people who have it.

## Submitting from Steward

**Make a bot** in Steward's Bots page ends with **Submit to the directory**. It downloads the pack's
folder as `<id>.zip`, checked the way an install is, and optionally credited to the person's
GitHub handle (kept as "based on an AI-made draft"). The person unzips it into a public
repository, or uploads the files to a gist (each skill as `<skill name>.SKILL.md`), and pastes the
address on this server's `/submit` page, which the same panel links to when Steward reads a
hosted directory. Steward never uploads anything itself.

## Counts

- **Installs.** Steward posts `POST <site>/api/bots/<id>/installed` when someone installs a bot,
  if its owner turned on `STEWARD_DIRECTORY_COUNTS`. No body, no identity. The server adds one to
  that bot's count for the day, at most once per address per bot per hour.
- **"I use this".** `POST /api/bots/<id>/used` (and `DELETE` to undo) for a signed-in account, or
  the button on the bot's page. One per GitHub account per bot.

`index.json`, the API, MCP and the pages all show the counts at once.

## MCP

```
https://<your site>/mcp
```

Streamable HTTP, stateless, no key, rate limited per address. The tools are the ones
[meetmybot.ai](https://meetmybot.ai) offers, so an agent that knows one directory can use the
other:

| Tool                                                     | What it returns                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `find_bots(query, category?, limit?)`                    | Ranked listings for a job in plain words.                           |
| `get_bot(id)`                                            | One bot with its instructions, starters, skills, rules and README.  |
| `latest(limit?, category?)`                              | The newest listings.                                                |
| `list_categories()`                                      | The categories with counts.                                         |
| `submit_bot(confirm_its_mine, pack_url, creator_handle)` | A pending submission, marked unverified until the creator signs in. |

Every result carries `pageUrl`, `packUrl`, `author` and the line "via the Steward directory", and
says listing text is third-party. Add it to Claude Code with:

```sh
claude mcp add --transport http steward-bots https://<your site>/mcp
```

## Privacy

What the server records, which `/privacy` says in full:

- install counts per bot per day, with no identity;
- "I use this" votes: the bot, the GitHub id, and when;
- sign-in sessions: GitHub id, handle, name and avatar address;
- submissions and claims: the pack, its address, the GitHub id and handle, the decision;
- reports and removal requests: the bot, the reason, the details, and the handle when signed in.

Client addresses stay in memory, in the rate limiter, for its window (a minute for pages, the API
and MCP; an hour for install counts, submissions and reports) and are then forgotten. There are
no analytics, no access log in the database, and no cookie but the sign-in session.

## What still needs a person

The software does the checks it can; these it cannot:

- **Reading the launch bots.** The plan asks that a person read the first 200 bots before launch.
  Every AI-made bot has passed the validators, the judge (3.5 of 5 or better) and the duplicate
  check, but nobody has read them. `directory/REPORT.md` lists them by category; the review page
  shows any one in full.
- **Reading the AI-proposed jobs.** `packages/bots-gen/src/jobs-ai.yaml` was written by a model.
  Move a job to `jobs.yaml` once someone has read it.
- **Vendor terms for generated output.** The seed bots were written and judged by NVIDIA's hosted
  Nemotron 3 Ultra. Whether its output may be published under MIT depends on NVIDIA's API and
  model terms, which have not been read for this (**UNVERIFIED**). Read them before publishing a
  hosted directory, or regenerate with a model whose terms allow it.
- **A GitHub OAuth app and reviewers.** Submissions are off until a host registers the app and
  names reviewers (see above).
- **Pull requests to a catalogue repository.** Approvals write the server's folder; opening a pull
  request against a separate `steward-bots` repository is not built.

## Checking it

```sh
pnpm vitest run apps/directory
curl -s http://127.0.0.1:8790/api/bots?q=plan+my+meals | head -c 400
curl -s http://127.0.0.1:8790/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
