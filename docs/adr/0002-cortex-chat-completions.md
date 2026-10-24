# ADR 0002: Models are called through Cortex's OpenAI-compatible Chat Completions API

- **Status:** accepted, 24 Oct 2026
- **Spec:** §11, §16.4

## Context
We want one account and many models (the user can pick their "AI engine"), three models voting in
the Consensus Court, and an MLH Snowflake prize that rewards real use. Cortex REST exposes an
OpenAI-compatible endpoint at `https://<account>.snowflakecomputing.com/api/v2/cortex/v1`, and MAF's
`OpenAIChatCompletionClient` accepts a `base_url`.

## Decision
All model calls go through `tempo_adapters/cortex.py`, which builds `OpenAIChatCompletionClient`
against the Cortex base URL with a programmatic access token (backend only). A router picks the
model per task type: letters → fast, money and eligibility → careful, tool loops → a tool-calling
model (Claude or OpenAI on Cortex), jurors → three different providers.

## Consequences
- Switching provider is a configuration change; Private mode points the same client at RunPod vLLM.
- Cortex quirks are handled in one place: an expired token returns **HTTP 200 with error 390112**,
  so a chat middleware refreshes the token and retries once; invalid JSON gets one repair retry.
- Only Claude and OpenAI models can call tools on Cortex, so the router must never send a tool
  loop elsewhere (there is a contract test for this).
- `make doctor` makes one 1-token call to prove the account, token, role and region work.
