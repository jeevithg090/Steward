# GitHub setup

How the team moved Tempo's front door from GitLab to GitHub without losing the GitLab pipeline,
and what a stranger does to contribute. Every step is a click or one command; nothing here needs
a secret.

## 1. Clone and set up

```bash
git clone https://github.com/jeevithg090/Tempo.git
cd Tempo
make setup                 # uv sync, pre-commit hooks, web deps, Docker services if present
make check                 # lint, types, fast tests: green before you touch anything
```

## 2. Remotes: GitHub first, GitLab as a mirror

`origin` is GitHub. The GitLab project stays as a mirror that runs the same pipeline
(`.gitlab-ci.yml`, plus the Playwright suite on `main`). Rather than remembering two pushes,
make `origin` push to both:

```bash
git remote -v
#   origin  https://github.com/jeevithg090/Tempo.git (fetch)
#   origin  https://github.com/jeevithg090/Tempo.git (push)
#   gitlab  https://gitlab.com/na-group4693543/Tempo.git (fetch)
#   gitlab  https://gitlab.com/na-group4693543/Tempo.git (push)

git remote set-url --add --push origin https://github.com/jeevithg090/Tempo.git
git remote set-url --add --push origin https://gitlab.com/na-group4693543/Tempo.git
git remote -v        # origin now shows two push URLs
```

The first `--add --push` is needed because adding a push URL replaces the implicit one. After
this, `git push origin main` lands on both. Push `skill-forge-wip` too, so the parked Skill Forge
work has a home on both remotes: `git push origin skill-forge-wip`.

## 3. Turn on Actions

*Settings → Actions → General*: allow actions and reusable workflows (the default), and under
*Workflow permissions* keep **Read repository contents and packages permissions**. The
workflows declare the little they need themselves (`permissions:` blocks). The first push to
`main` after that runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## 4. Protect `main`

*Settings → Branches → Add branch ruleset* (or classic protection rule) for `main`:

| Setting | Value |
|---|---|
| Require a pull request before merging | on, **1** approving review, require review from Code Owners, dismiss stale approvals |
| Require status checks to pass | on, **require branches to be up to date**, and these six checks by name: `lint-type`, `fast-tests`, `integration`, `web`, `skills`, `security` |
| Require conversation resolution | on |
| Require linear history | on (rebase or squash merges only) |
| Block force pushes and deletions | on |
| Include administrators | on |

The check names are the `name:` of each job in `ci.yml`; a renamed job must be renamed here too.
The same, as one command once the first CI run has reported the checks:

```bash
cat > /tmp/protection.json <<'EOF'
{
  "required_status_checks": {"strict": true,
    "contexts": ["lint-type", "fast-tests", "integration", "web", "skills", "security"]},
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 1,
    "require_code_owner_reviews": true, "dismiss_stale_reviews": true},
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF
gh api -X PUT repos/jeevithg090/Tempo/branches/main/protection --input /tmp/protection.json
```

Merging then needs a green pipeline and one approval from [`CODEOWNERS`](../CODEOWNERS); replace
the `@owner-*` placeholders there with GitHub usernames or the per-path rules do nothing.

## 5. Security features

*Settings → Code security*:

- **Dependabot alerts** and **Dependabot security updates**: on. Version updates are already
  configured in [`.github/dependabot.yml`](../.github/dependabot.yml) (uv, the two pnpm
  lockfiles, Actions; weekly, grouped).
- **Private vulnerability reporting**: on. [`SECURITY.md`](../SECURITY.md) sends reporters to
  the *Security → Report a vulnerability* form, so this must be enabled before the repo is public.
- **Secret scanning** and **push protection**: on when the repository is public (free there).
  gitleaks already runs in pre-commit and in the `security` job; push protection is a second net.

As commands:

```bash
gh api -X PUT repos/jeevithg090/Tempo/vulnerability-alerts
gh api -X PUT repos/jeevithg090/Tempo/automated-security-fixes
gh api -X PUT repos/jeevithg090/Tempo/private-vulnerability-reporting
```

## 6. Releases need one environment

[`.github/workflows/release-images.yml`](../.github/workflows/release-images.yml) runs on a
`v*` tag inside an environment called **`release`**. Create it under *Settings → Environments*,
add yourselves as **required reviewers** (that is what makes the job manual, like GitLab's
`when: manual`), and give it the secrets `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`,
`RUNPOD_API_KEY` and the variable `RUNPOD_TEMPLATE_ID` when they exist. Until the cosign key pair
is generated and `deploy/transparency/cosign.pub` is committed, the job stops at
`cosign verify-blob` by design ([`deploy/transparency/README.md`](../deploy/transparency/README.md)).

## 7. Topics and the About box

*About → ⚙*: description "Your time, returned: an open-source personal AI agent where models read
and plan and code decides money, time and permissions", website = the Vercel URL, and topics:

```bash
gh repo edit jeevithg090/Tempo --description "Your time, returned: an open-source personal AI agent" \
  --add-topic ai-agent --add-topic accessibility --add-topic consumer-rights \
  --add-topic delay-repay --add-topic fastapi --add-topic nextjs --add-topic python \
  --add-topic agent-framework --add-topic open-source
```

## 8. Making it public

In this order, so nothing is exposed half-configured:

1. `gitleaks git --redact .` locally is clean (the `security` job runs it on every push too).
2. Private vulnerability reporting is on (step 5), so the first report has somewhere to go.
3. Branch protection is on (step 4).
4. *Settings → General → Danger Zone → Change visibility → Public*, or
   `gh repo edit jeevithg090/Tempo --visibility public --accept-visibility-change-consequences`.
5. Then turn on secret scanning and push protection (free for public repositories).
6. The README's Vercel button works for strangers from this moment: it clones a public repo.

## 9. Secrets: what CI needs (nothing)

The CI workflow needs **no secrets**. Every job runs in replay mode on recorded fixtures;
`GITHUB_TOKEN` is provided by GitHub. Never add any of the `.env.example` values (vendor keys,
`TEMPO_API_TOKEN`, `DATABASE_URL`, `MANDATE_SIGNING_KEY`, VAPID keys) to Actions secrets: no
job reads them, and a secret nobody reads is only a liability. The only secrets GitHub ever
holds for Tempo are the release environment's (step 6), and `GITLEAKS_LICENSE` if the repository
ever moves into an organisation (gitleaks-action is free for user accounts).

## 10. How a fork contributes

1. Fork `jeevithg090/Tempo` on GitHub and clone the fork.
2. `git remote add upstream https://github.com/jeevithg090/Tempo.git` and
   `git fetch upstream` before each new branch: `git switch -c skill-lner upstream/main`.
3. Work, `make check`, commit, push to the fork, open a pull request against `main`. CI runs on
   the pull request with a read-only token; fork pull requests never see repository secrets, and
   none are needed.
4. Address review, rebase onto `upstream/main` if asked (linear history), and a code owner merges.

The honesty checklist in the pull request template is the whole review bar for a rule pack:
`demo_values: true`, a `citation_url`, plain words, tests by marker, `make check` green.
[`docs/add-a-usecase.md`](add-a-usecase.md) walks the ten minutes from idea to pull request.
