# Devpost draft (edit before submitting)

> Checklist before pasting: replace the GitLab URL, list the exact Cortex models and Gemini model
> you used, paste the latest rows of evals/report.md, and remove anything you didn't get working
> live. Everything below is true of the code in this repo as of the commit you submit.

**Tagline.** Your time, returned.

**Inspiration.** Life is full of sludge: queues, forms, deadlines and unclaimed refunds. Fewer
than half of eligible UK rail passengers claim delay compensation, and the people who lose most
have the least time and tech confidence. Two in three people want an AI to deal with companies
for them; almost nobody has one.

**What it does.** Tempo is an open-source personal AI agent you can reach by phone, text or the
web. Our flagship skill pack, Clawback, takes a late train from "my train was late" to money in
your account:
- finds the delay in National Rail and Realtime Trains data (through an MCP server)
- works out exactly what you're owed from rules written as code, with a Proof Trace: fact,
  rule, published source, amount
- has three models from three providers check the interpretation (the Consensus Court); they can
  say no or ask you, but they can never change the amount
- weighs whether it's worth your time, using your own value of an hour
- asks you once, in plain words, and acts only on a signed yes; "STOP" stops everything
- files once, then waits (durably, for days if needed) until the money has actually arrived

**How we built it.**
- **Orchestration:** Microsoft Agent Framework workflows with checkpoints, so a mission survives
  a crash or deploy and re-asks the same question; consent pauses through `request_info`;
  durable payment timers.
- **Guardrails:** our policy engine as fail-closed Agent Hooks: settlement guard, consent scope,
  proof required, injection shield, PII redaction, with a plain-middleware fallback that passes
  the same test suite.
- **Models:** Snowflake Cortex through its OpenAI-compatible API (one account, many models), with
  a model router and a three-juror Consensus Court; Gemini reads tickets and letters.
- **Voice:** ElevenLabs agents defined as code: Tempo for callers, a Negotiator that phones
  companies, and a Sludge Arena of adversarial company agents (staller, injector, lowballer).
- **Data and ops:** FastAPI Gateway with Twilio SMS and ElevenLabs webhooks, Postgres with an
  append-only consent ledger, OpenTelemetry traces in Langfuse, Mission Control in Next.js.

**Challenges.** Keeping language models away from money decisions; Cortex returning an expired
token as HTTP 200; tonight's clock change (Python subtracts same-zone datetimes naively, so a
delay across 01:00–02:00 would have been out by an hour; we compute in UTC and take the smaller
delay in the repeated hour); and approvals that MAF asks for before any guardrail runs, which led
to "standing approvals within limits" for live calls.

**Accomplishments.**
- Every pound has a citation, and the amount never comes from a model.
- Kill the server mid-mission and it resumes with the same question.
- 400+ automated tests, including property tests for the money and consent logic, and evals for
  extraction, the court, the Arena and plain language.

**What we learned.** Agents become trustworthy when language models read and plan while code
decides and a harness enforces. Accessibility first (voice, SMS, plain words) changes who AI can
serve.

**What's next.** Tempo Memory (Mem0 + Graphiti, with a Memory Gate against poisoning), the Tempo
Mesh (passkey approvals across phones), more skill packs (flights, broadband, energy), and a
private mode on our own GPUs with device-held keys.

**Honesty notes.** In the demo, the company is our Arena agent or a simulated operator, and the
screen says so. Rule packs are marked "demo values" until checked against each operator's
published terms. Replay mode uses synthetic journeys and recorded juror verdicts.

**Built with.** Python, Microsoft Agent Framework, Snowflake Cortex, ElevenLabs, Twilio, Gemini,
FastAPI, Postgres, OpenTelemetry, Langfuse, Next.js, GitLab.

**AI tools disclosure.** Snowflake Cortex models (list them), Gemini (model), ElevenLabs Agents,
and AI coding assistants (Claude Code).
