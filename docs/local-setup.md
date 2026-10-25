# Run Tempo on your own machine

From a fresh clone to the whole app on <http://localhost:3000> in about five minutes. No accounts,
no keys and no database are needed: the local demo runs on made-up rail data, and the yellow badge
at the top of the app says so.

- [1. What you need](#1-what-you-need)
- [2. Get the code](#2-get-the-code)
- [3. Run it](#3-run-it)
- [4. Try it](#4-try-it)
- [5. Optional: real models and a real voice](#5-optional-real-models-and-a-real-voice)
- [6. Run the tests](#6-run-the-tests)
- [7. Troubleshooting](#7-troubleshooting)

## 1. What you need

| Tool | Version | Why |
|---|---|---|
| [git](https://git-scm.com/) | any | to clone the repository |
| [uv](https://docs.astral.sh/uv/) | 0.13 or newer (`uv --version`) | installs Python 3.12 and every Python package for you |
| [Node.js](https://nodejs.org/) with npm | 22.22 or newer, 24.15 or newer, or 26 and up; not 23 or 25 (`node --version`) | the web app; CI uses 22 |
| `make` and `curl` | any | the one-word commands below; the demo script checks the Gateway with curl |
| [gitleaks](https://github.com/gitleaks/gitleaks) | 8.19 or newer | only if you will commit: a commit hook uses it to check for leaked keys, and every `git commit` fails without it |
| [Docker](https://docs.docker.com/get-docker/) | optional | Postgres and Neo4j for the integration tests, and Local mode |

You don't need to install Python yourself: uv reads `.python-version` and fetches 3.12.

**macOS.** Type every command in this guide into Terminal (press Command-Space, type `Terminal`,
press Return). If you don't have [Homebrew](https://brew.sh/), paste the install line from its home
page. When it finishes, run the commands it prints under **Next steps**, then open a new Terminal
window; otherwise you'll see `brew: command not found`. Then:

```bash
brew install git uv node gitleaks
```

**Linux** (Ubuntu, Debian, and WSL):

```bash
sudo apt update && sudo apt install -y git make curl   # Fedora: sudo dnf install git make curl
curl -LsSf https://astral.sh/uv/install.sh | sh        # uv
```

For Node.js, use [nvm](https://github.com/nvm-sh/nvm): run the install line from its README, open a
new terminal, then `nvm install 22`. Don't use `apt install nodejs`: Ubuntu's is too old. For
gitleaks, download a release from <https://github.com/gitleaks/gitleaks/releases> (distribution
packages are often too old).

**Windows.** Install [WSL 2](https://learn.microsoft.com/windows/wsl/install) with Ubuntu, open the
Ubuntu app, and follow the Linux steps in that window, `git clone` included. Clone into your Linux
home folder (type `cd ~` first), not into a Windows folder under `/mnt/c`, and don't clone with Git
for Windows: a Windows copy changes the scripts' line endings (you'd see
`bash\r: No such file or directory`) and makes installs slow.

## 2. Get the code

```bash
git clone https://github.com/jeevithg090/Tempo.git
cd Tempo
make setup
```

Use `git clone`, not GitHub's **Code → Download ZIP**: a ZIP has no `.git` folder, so `make setup`
stops at step 2.

Run every command in this guide from the `Tempo` folder. A new terminal window starts in your home
folder, so type `cd Tempo` there first (or `cd` to wherever you cloned it).

`make setup` does four things:

1. `uv sync` creates `.venv` with Python 3.12 and every package.
2. `uv run pre-commit install` adds the lint, test and secret-scan hooks to your commits.
3. `npm ci` in `apps/web` installs the web app's packages. npm may end with warnings such as
   "3 moderate severity vulnerabilities". That's normal and setup has worked. Don't run the
   `npm audit fix --force` it suggests: it rewrites the pinned packages and breaks the build.
4. `docker compose up -d` starts Postgres and Neo4j, if Docker is installed. Without Docker it
   prints a note and carries on. If Docker is installed but not running, this step fails with
   `Cannot connect to the Docker daemon` and `make` ends with `Error 1`. Steps 1 to 3 are done,
   so ignore it: nothing in the demo needs these services.

Without `make`, run the same steps by hand: `uv sync`, then `(cd apps/web && npm ci)` (the brackets
bring you back to the `Tempo` folder). Later, use `scripts/demo.sh` wherever this guide says
`make demo`, and `scripts/demo.sh --gateway-only` for `make demo-gateway`.

To check that everything works before you change anything:

```bash
make check      # lint, types and the fast tests, in about a minute
```

## 3. Run it

Pick one. The first two serve the web app on <http://localhost:3000>; the third tells the story in
your terminal.

### The whole thing, offline (recommended)

```bash
make demo
```

This runs [`scripts/demo.sh`](../scripts/demo.sh), which:

- starts the **Gateway** (Tempo's backend) on <http://127.0.0.1:8000> in replay mode, with the
  bearer token `devtoken`;
- **seeds the demo's people**, so there is something to see straight away: Amir's train claim is
  already paid, and Margaret's late-train claim and broadband case are waiting for an OK (the app
  runs on her demo account);
- starts the **web app** on <http://localhost:3000>, already pointed at that Gateway.

Ctrl-C stops both. The Gateway runs from a scratch folder next to the repository
(`../.tempo-demo`), never from inside it (see [Troubleshooting](#7-troubleshooting) for why). Its
log is `../.tempo-demo/gw.log`.

To run the two halves separately, for example while you work on the web app:

```bash
make demo-gateway                      # the Gateway, seeded, left running in the background
cd apps/web && npm run dev             # the web app, with hot reload; Ctrl-C stops it
cd ../.. && scripts/demo.sh --stop     # later, back in the Tempo folder: stop the Gateway
```

### Just the web app, no backend

```bash
make showcase
```

The web app runs on recorded answers, with no Gateway and no keys: the same app and recordings as
[tempo-showcase.vercel.app](https://tempo-showcase.vercel.app).

### The story in your terminal

```bash
make demo-dry-run
```

The late-train claim from start to finish, as text: found, priced, asked once, claimed and paid,
with a restart in the middle to show that nothing is lost.

## 4. Try it

Open <http://localhost:3000>. Use `localhost`, not `127.0.0.1`: Face ID and fingerprint sign-in
(passkeys) only work on `localhost` or https. Then type, or tap the matching example:

- *My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40*. The demo has
  already started this claim, so Tempo says it is waiting for your OK and shows the price,
  £14.20. Press **Yes, claim £14.20** on the card under the answer, rather than typing "yes": the
  broadband case is waiting too, and a typed yes can answer that one instead. The Gateway checks
  for the payment by itself every 30 seconds; to see it at once, open Mission Control and press
  **Check the payment now**.
- *The Broadbandly engineer never came on 19 October*
- *Is this a scam? HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at
  http://hmrc-refunds-gov.uk/claim*
- *What do you remember about me?*
- *Find money I'm owed in my email*. This reads a demo mailbox, calendar and bank statement, not
  yours.

The rail data is made up for the demo. It holds four Oxford to London Paddington trains: the 07:58
on 22 October 2026, and the 08:12, 09:12 and 17:42 (cancelled) on 23 October 2026 (`make showcase`
has only the 08:12). The day and the departure time must both match, so any other train gets
"I couldn't find the … in the rail records". [docs/demo.md](demo.md) walks through every beat.

## 5. Optional: real models and a real voice

Everything above works with no keys. To add real services, put a `.env` file in the **scratch
folder** `../.tempo-demo/.env`, not in the repository. `make demo` reads it, and prints
`Reading …/.env` when it does.

```bash
# ../.tempo-demo/.env
NVIDIA_API_KEY=nvapi-...      # the chat's brain: Nemotron 3 Ultra holds the conversation
CHAT_BRAIN=nvidia             # use the brain even though the rail data stays made up
ELEVENLABS_API_KEY=sk_...     # Tempo's real voice (a free plan works); otherwise the browser speaks
```

After changing it, stop the Gateway and start it again: Ctrl-C and `make demo`, or
`scripts/demo.sh --stop` and `make demo-gateway`. A Gateway that is still running keeps its old
settings, and `make demo` reuses it rather than starting a new one.

To check that the brain is on, open <http://127.0.0.1:8000/health>: the `chat` entry shows a
`brain` (for example `nvidia:nvidia/nemotron-3-ultra-550b-a55b`). With no brain, Tempo's
rule-based chat answers, and it handles every example above.

[`.env.example`](../.env.example) lists the settings, and [docs/deploy.md](deploy.md) has the full
matrix. [CONTRIBUTING.md](../CONTRIBUTING.md) has you copy `.env.example` to a `.env` inside the
repository: that file is for commands run from the repository, such as `make doctor`, and
`make demo` never reads it.

Never point the demo at a database. `make demo` refuses a `.env` in the scratch folder that sets
`DATABASE_URL`, and ignores one set in your shell, so the demo's claims and memories always stay
on your machine.

**Fully local, no cloud at all.** `make local` runs Postgres, Ollama and the Gateway in Docker on
this machine. It needs Docker running and about 5 GB of free disk: the first run builds the Gateway
image and downloads the `qwen3:8b` model. It uses port 8000, so stop `make demo` first. It starts
no web app and no demo people. Give it a long token of your own, in the shell:

```bash
TEMPO_API_TOKEN=pick-a-long-token make local
```

Then run the web app with `cd apps/web && npm run dev` and enter the same token in its
**Settings**.

## 6. Run the tests

```bash
make check       # lint, types, fast tests (Python)
make web-check   # web app: type-check, tests and both builds
make test-int    # integration tests (Postgres from Docker, or TEST_DATABASE_URL)
make e2e         # Playwright, against its own replay Gateway on 8010 and web app on 3010
make help        # every command
```

Before your first `make e2e`, download Playwright's browser once:

```bash
cd tests/e2e && npm ci && npx playwright install chromium && cd ../..   # Linux: add --with-deps
```

## 7. Troubleshooting

| What you see | What to do |
|---|---|
| `make: *** No rule to make target 'demo'` | You're not in the `Tempo` folder. `cd Tempo` and try again. |
| `no .venv in …; run 'make setup'` | Run `make setup` once (or `uv sync`). |
| `brew: command not found` | Run the **Next steps** commands the Homebrew installer printed, then open a new Terminal window. |
| `uv: command not found` or `npm: command not found` | Install them (section 1), then open a new terminal. |
| `Cannot connect to the Docker daemon` at the end of `make setup` | Docker is installed but not running. Ignore it for the demo, or start Docker and run `docker compose up -d`. |
| `git commit` fails with ``Executable `gitleaks` not found`` | Install gitleaks (section 1). |
| `bash\r: No such file or directory` | The copy has Windows line endings. On Windows, clone inside WSL's home folder (section 1). |
| Port 8000 is already in use | See what holds it with `lsof -i :8000`. If it is an earlier demo Gateway, `scripts/demo.sh --stop` ends it. A Gateway that already answers on 8000 is reused, not replaced. |
| Vite prints `Port 3000 is in use, trying another one...` and the app opens on 3001 | Something else holds port 3000, and the Gateway only accepts the web app from 3000, so the app on 3001 can't reach it. Press Ctrl-C, stop what holds 3000 (`lsof -i :3000`), and start again. |
| The web app says it can't reach the Gateway | Check <http://127.0.0.1:8000/health>. In the app, **Settings** sets the Gateway's address and token (`http://127.0.0.1:8000`, `devtoken`), or turns on the showcase. |
| `…/.env sets DATABASE_URL` | Remove that line from `../.tempo-demo/.env`. The demo only uses its own local files. |
| The Gateway exits on start | Read the end of `../.tempo-demo/gw.log`. |
| Face ID or fingerprint is not offered | Open the app at `http://localhost:3000`, not `127.0.0.1`. |
| "I couldn't find the … in the rail records" | Only four made-up trains exist (section 4), and the day and time must both match. Use the example as written. |

**Why the Gateway never runs from inside the repository.** The Gateway reads `.env` from the
folder it starts in. A teammate's `.env` in the repository may point `DATABASE_URL` at a shared,
hosted database. Starting from `../.tempo-demo` keeps your demo's claims and memories on your own
machine.

Stuck? Open an issue with what you ran and the end of `../.tempo-demo/gw.log`. To contribute, see
[CONTRIBUTING.md](../CONTRIBUTING.md) and [docs/github-setup.md](github-setup.md).
