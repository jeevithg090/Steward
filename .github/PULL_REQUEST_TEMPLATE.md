## What this changes

<!-- One or two sentences, from the point of view of someone using Steward. Link the issue: Fixes #123 -->

## Why

<!-- The problem it solves, or the decision behind it. -->

## How it was tested

<!-- The commands you ran, and anything you checked by hand. Screenshots before and after for anything on screen. -->

- [ ] `pnpm check` passes (typecheck, Biome, Vitest)
- [ ] `pnpm e2e` passes, if this changes anything on screen or in the server
- [ ] `pnpm eval:triage` results attached, if this changes triage

## Checklist

- [ ] Every tool call still goes through the gateway, and errors still refuse.
- [ ] No secret can reach the transcript, the record or a log.
- [ ] Nothing addresses the person by a name they did not give (prompts, demo data, fixtures, examples).
- [ ] Demo data and the scripted model are still labelled on screen.
- [ ] New or changed refusal paths have tests, not only the happy path.
- [ ] Anything on screen works with the keyboard alone and has names a screen reader can say.
- [ ] Docs are updated (`docs/`, the README, or a tenant package's comments).
- [ ] Code adapted from another project says so in a header comment, and NOTICE lists the project.

<!-- Changes to packages/gateway, packages/computer, the connectors' network guard or the server's HTTP guards: say what could go wrong and how the tests show it does not. They get a second reviewer. -->
