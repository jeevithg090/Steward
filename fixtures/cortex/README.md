# Cortex fixtures

These responses are **hand-written in the documented shapes**, not recorded yet:

- `chat_completion_ok.json`: an OpenAI Chat Completions response, the format the Cortex REST
  endpoint `/api/v2/cortex/v1/chat/completions` returns.
- `token_expired_390112.json`: the HTTP 200 body Snowflake returns for an expired token.

Once the team has a working PAT, replace them with real responses from one live call each
(strip the ids), and keep the file names so the contract tests keep working.
