# Crypto scam check

Checks a crypto project for common scam signals and gives a plain one-page summary.

## What it does

- Takes a project name, website, token contract, or social handle.
- Collects public data from the site, block explorer, audits, team profiles, and socials.
- Runs 20 checks covering token contract, team identity, documentation, audits, community, and regulatory warnings.
- Returns a one-page report with a table of signals, an overall flag (High/Medium/Low/Inconclusive), and sources.

## What it needs

- Web search and fetch (no API keys).
- The person provides at least a name or contract address.

## What it will not do

- It does not access private data, wallets, or non-public chats.
- It does not give financial advice or a buy/sell recommendation.
- It cannot verify off-chain claims (bank accounts, legal entities, off-chain reserves).
- Unknown means the information was not found, not that it is safe.
