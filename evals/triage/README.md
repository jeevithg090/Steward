# Triage eval

Measures how well Steward sorts incoming mail into **needs you** and **can wait**. It runs the same
code the server runs (`packages/proactive/src/triage.ts`) against a labelled set.

## The set

`dataset.jsonl` holds 62 invented emails to the owner of a small ceramics studio, on the morning of
Thursday 22 October 2026. 27 need the owner and 35 can wait. Each row carries the label a careful
assistant should give and the reason a person would accept.

It is adapted from OpenDuet's triage set (MIT, CopilotKit) with the labels unchanged. The inbox
owner is never named: their address is `owner@marlowceramics.com`, greetings say "Hi", and the one
message that asks the owner directly while copying them says "to the owner, copied here". The
reasons speak to the person as "you", like Steward's own.

It includes the cases that go wrong in practice:

- marketing that sounds urgent;
- `noreply` mail that does need the owner: a failed payment, a paused store, a security alert;
- a phishing message, and a message that tries to give the assistant instructions;
- a customer company's newsletter;
- a thread where the owner is only copied but asked directly;
- a request that says there is no rush;
- a security report sent to the team's security@ group, which arrives with list headers in Forums;
- a vendor's "rotate your access tokens" notice with an unsubscribe header, in Updates.

The last two were once settled as "can wait" by list headers alone. The rules now act on those
headers only where the mail was also filed under Promotions or Social.

Each row: `id` (`n01`–`n27`, `c01`–`c35`), `label`, `why`, `from`, `to`, `cc`, `subject`,
`receivedAt`, `headers`, `labels` (Gmail label ids) and `body`. No real mail is used.

## The measures

- **Precision for needs you**: of the emails flagged, how many really needed the person. A low number
  is a brief people learn to ignore.
- **Recall for needs you**: of the emails that needed the person, how many were flagged. A low number
  means something important slipped past.
- **Recall matters more.** Missing a failed payment costs more than reading one extra line, so the
  headline score is **F2**, which weighs recall four times as much as precision.
- **Accuracy** over all 62.
- **Decided by rules (wrong)**: rules must only settle what can wait, so "wrong" must be 0. The runner
  exits with an error otherwise, which makes it a useful CI check.
- **Unsorted**: emails nobody could sort (no model, or the model failed). They count as flagged,
  because that is how they appear on screen.

## Running it

```sh
pnpm eval:triage                 # rules only, then the model when one is configured
pnpm eval:triage --rules-only    # rules only, no model calls
```

The model comes from the environment, first match wins:

| Variables                                                                      | Endpoint and model                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `STEWARD_EVAL_BASE_URL`, `STEWARD_EVAL_MODEL`, optional `STEWARD_EVAL_API_KEY` | Any OpenAI-compatible endpoint, such as Ollama at `http://localhost:11434/v1` |
| `OPENROUTER_API_KEY`, optional `STEWARD_EVAL_MODEL`                            | OpenRouter, default `anthropic/claude-haiku-5.5`                              |

It prints a table and writes `results.md` beside this file, with every verdict and a Disagreements
section. Requests use temperature 0 and six at a time. Errors from the endpoint are reported by status
only, never by body, because results files get committed.

## Rules-only baseline

With no model, the rules settle 12 of 62 and get none wrong, and everything else is shown as
"needs you": recall 100%, precision 54%, F2 85.4%. That is Steward's honest behaviour with no
model: nothing that matters is hidden, at the cost of a long list.

## What the numbers mean, and what they don't

The set is small and invented, and the labels and the prompt come from the same hands. Treat it as a
regression check for changes to the rules, the prompt or the model, not as proof of accuracy on a
real inbox. Corrections from real use ("this could have waited", "this needed me") are the next
source of labels.
