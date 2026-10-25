# Accessibility

## The statement

Tempo is for the people who are hit from every side at once: who cannot read the letter, cannot
hear the call, cannot navigate the app, and are the ones scammers target. So it is built the
other way round from most AI agents. It answers a **landline** and a **text message** before it
has a screen. It is **patient by default** for everyone and adapts its language, pace and voice
to the caller before the first word. It asks **one question at a time** and reads back what it
heard. Every sentence it says is checked for **plain words** in CI. On the web the chat is the
front door: type or speak (the browser's recogniser), and Tempo answers in text and, if you want,
out loud (the Gateway's voice, or the browser's). The app is dark, high-contrast, keyboard- and
screen-reader-usable, and puts text size, a plain mode, reduced motion and the language Tempo
speaks under the person's own control in Settings. And it **cannot** move your money or act without your signed yes, which is the
accessibility feature that matters most to someone who is frightened of getting it wrong.

We aim for WCAG 2.2 AA on the web app and for the spirit of it on the phone. The checklist below
says, item by item, what is true, how it is checked, and what is not done. Written 25 Oct 2026
against `main`; revised the same night for the Vite app (`apps/web`, see `docs/web.md`).

## What "better than screen-first agents" means, in checkable terms

The agents people hear about (Muse and its kind) are screen-first, English-first and click-fast.
Each claim here has a place in the code and a test.

| Claim | Where | How it is checked |
|---|---|---|
| **Voice and SMS first.** A landline reaches everything: start a mission, say yes or no, STOP, hear or forget memories, check a message for scams | `POST /voice/tools/{name}` (the ElevenLabs server tools in `apps/gateway/src/tempo_gateway/app.py:VOICE_TOOLS`), `POST /sms/inbound` (`YES`, `NO`, `STOP`, `HELP`, `MEMORY`, `FORGET <thing>`, `CHECK <message>`) | `tests/integration/test_gateway.py::test_a_mission_can_be_created_and_approved_by_voice`, `::test_sms_yes_resolves_pending_request`, `::test_sms_stop_revokes_consent_and_kills_mission`, `::test_every_voice_tool_has_a_route` |
| **Patient by default, for everyone.** The line waits 15 s for a turn, ends a call only after 3 minutes of silence, and is told never to rush or interrupt | `voice/agents/tempo.inbound.yaml` (`turn.turn_timeout_s: 15`, `silence_end_call_s: 180`, `eagerness: patient`; the prompt: "Be patient. Never rush or interrupt") | `tests/unit/test_voice_configs.py` |
| **Per-caller language, pace and voice** from the Patience Profile: a stammer means patience, hearing loss means a lower, steadier, slower voice and the question by text, "speak Hindi" means Hindi, "slower" means 0.85× | `tempo_core/voice_profile.py:profile_from`, `how_to_speak`, `to_initiation`; the Gateway answers ElevenLabs' conversation-initiation webhook at `POST /voice/initiation`; `GET /voice/profile` shows it | `tests/unit/test_voice_profile.py` (`test_a_stammer_means_patience_not_a_different_voice`, `test_hard_of_hearing_is_lower_slower_and_steadier`, `test_hindi_and_slower`, `test_other_categories_never_change_how_tempo_speaks`), `tests/integration/test_gateway_voice_profile.py` |
| **Access needs are the person's own words**, opt-in, dated, visible and forgettable. Rules recognise "I have a stammer", "speak slowly", "text me the questions", "in Punjabi, please" | `tempo_memory/extract.py` (the `access` rules), `tempo_memory/gate.py` (`access` is `OPT_IN`, read back before it is kept, never expires: `tempo_memory/models.py:TTL`) | `tests/unit/test_memory_extract.py::test_access_needs_are_their_own_category`, `tests/unit/test_memory_gate.py::test_sensitive_category_requires_consent` |
| **Access needs travel with a profile** (`access.language`, `pace`, `patience`, `voice`, `prefers_text`, `plain_words`), so `hard-of-hearing` or `take-your-time` set the line up before the first word | `tempo_core/profiles.py:AccessNeeds` (a language must have a voice preset), `profiles/*.yaml` | `tests/unit/test_profiles.py`, `make validate-skills` |
| **Plain words, gated in CI.** Every message family Tempo sends scores Flesch reading ease ≥ 60 | `tempo_core/readability.py:flesch_reading_ease`; the 21 message families in `tests/unit/test_plain_language.py::messages` come from the real code paths (engine, Arbiter, intake, mission outcomes, memory, scam advice, Rights Decay); profile summaries and guard messages are gated the same way | `tests/unit/test_plain_language.py::test_tempo_speaks_plainly` fails the build if any sentence drops below 60; `tests/policy/test_profile_guards.py::test_every_message_is_in_plain_words`; `tests/unit/test_letters.py::test_read_it_to_me_speaks_plainly`; `tests/unit/test_payee.py::test_before_you_pay_speaks_plainly` |
| **One question at a time, with read-back.** Vision reads a ticket, a card or a letter and asks about one unsure fact at a time, most important first; a memory under 0.8 confidence is read back before it is kept | `tempo_core/intake.py:follow_up`, `tempo_gateway/memory.py:readback_question`, `tempo_memory/gate.py:READ_BACK_BELOW`, `tempo_core/letters.py` | `tests/unit/test_intake.py`, `tests/unit/test_memory_gate.py::test_low_confidence_triggers_readback`, `tests/unit/test_letters.py::test_each_unsure_fact_becomes_one_plain_question_most_important_first` |
| **STOP on every channel.** SMS `STOP`, saying "stop" on a call, the stop button on the web; it revokes consent and every mandate at once | `app.py` (`word == "STOP"` → `service.stop`), `POST /missions/{id}/stop`, the prompt line "They can say 'stop' at any time and you stop", `MandateService.revoke_all` | `tests/integration/test_gateway.py::test_sms_stop_revokes_consent_and_kills_mission`, `tests/integration/test_mandates.py::test_revoke_and_stop_by_sms_end_the_mandate_everywhere` |
| **Nothing binding without a signed yes**, and a signed no can't become a yes | `tempo_gateway/mesh.py` (passkeys), `tempo_core/consent.py` (deny wins) | `tests/integration/test_mesh.py::test_a_signed_no_cannot_become_a_yes`, `tests/unit/test_consent.py` |
| **Visible focus, large text, reduced motion** on the web | `apps/web/src/index.css`: `html[data-text-size="large"]` 118% and `"larger"` 136%, `html[data-plain]` (every control at least 44 px tall), `html[data-reduce-motion]` (animation and transitions off); every control carries `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white` (plan.md §4.7); `lang="en"` on the document (`apps/web/index.html`) | axe through `apps/web/src/test/a11y.ts:expectNoA11yViolations` in each page's `*.test.tsx` (plan.md §4.8); colour contrast is skipped there because jsdom does not paint, so it is checked by hand |
| **Text size, plain mode, reduced motion and language, chosen by the person** in Settings and kept per browser: A, A+, A++ (`html[data-text-size]`), a plain mode with bigger targets and fewer extras (`html[data-plain]`), a Reduce motion switch (`html[data-reduce-motion]`), and the language Tempo speaks (English, Hindi, Punjabi, Polish, Urdu, Welsh); the boot script in `index.html` applies them before the first paint | `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/lib/a11y-prefs.ts`, the `data-*` rules in `apps/web/src/index.css` | the Settings page's test with axe |
| **Skip link, landmarks, consistent navigation** on every page: "Skip to content" is the first focusable thing, `<nav aria-label="Primary">`, one `<main id="main">`, one `<h1>` per page (`PageTitle`), the honesty badge in the header, Settings (with the controls) at the foot of the sidebar | `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `PageTitle` in `apps/web/src/components/ui/SectionTitle.tsx` | axe in the page tests |
| **Live regions** announce state changes to screen readers | every page uses `aria-live` for state changes (plan.md §4.7): the chat's replies, mission state in Mission Control, `role="status"` on Who's calling? and the Passport card; the controls announce their own changes | axe in the page tests |
| **Other languages are marked as such** where the web shows them: a caller's greeting, a letter's reading and a spoken scam warning carry `lang` (and `dir` for right-to-left) | `apps/web/src/features/callers/CallersPage.tsx`, `apps/web/src/features/read/ReadPage.tsx`, `apps/web/src/features/shield/ShieldPage.tsx` | by inspection, as each page lands |

## WCAG 2.2 AA checklist (web app)

Status: **yes** (in the tree, checked by test or by hand), **partly** (true for some of it, with
the gap named), **not checked** (nothing known to be wrong; nobody has measured), **no**.

| Criterion | Status | Notes |
|---|---|---|
| 1.1.1 Non-text content | partly | Icons are lucide with `aria-hidden`; charts and gavels in the mission components carry `role="img"` with `aria-label` (plan.md §4.7); the README screenshot has alt text; axe (`image-alt`, `aria-*` rules) runs on every page in tests. The avatar's face is decorative |
| 1.3.1 Info and relationships | yes | Skip link, `<nav>`, one `<main>`, labelled `<section>`s, headings; axe checks landmark and heading rules |
| 1.3.4 Orientation / 1.3.5 Input purpose | not checked | Few inputs; no orientation lock |
| 1.4.1 Use of colour | partly | Court votes, states and badges carry words as well as colour; not audited everywhere |
| 1.4.3 Contrast (minimum) | partly | Body text (`text-slate-200`) on the near-black canvas (`#0a0a0c`) and the charcoal cards (`#1f1f22`) is far above 4.5:1, and the small section labels (`text-slate-400`) pass on the cards; accent and badge colours are not measured, there is no `prefers-contrast: more` rule yet, and axe's colour-contrast rule is off in jsdom |
| 1.4.4 Resize text | yes | Tailwind's `rem` sizes scale with the root; the A/A+/A++ control (118% / 136%) and 200% browser zoom both work |
| 1.4.10 Reflow | not checked | Responsive utility classes; plain mode collapses grids to one column; not verified at 320 px |
| 1.4.11 Non-text contrast | not checked | The focus ring is a 2 px white outline on dark surfaces (passes); controls not measured |
| 1.4.12 Text spacing | not checked | |
| 1.4.13 Content on hover or focus | yes | No hover-only content |
| 2.1.1 Keyboard / 2.1.2 No keyboard trap | partly | Native buttons and links throughout; the QR pairing and passkey dialogs are browser-native; axe checks focusable-element rules. No full manual keyboard walk recorded |
| 2.2.1 Timing adjustable | yes | No time limits on the web. Voice: 15 s turn timeout and 3 min silence are the line's defaults and the agent is told to wait as long as it takes |
| 2.3.1 Three flashes | yes | Nothing flashes |
| 2.3.3 Animation from interactions (AAA) | partly | The Reduce motion switch (`html[data-reduce-motion]`) disables all animation and transitions, including the avatar's blink and the pulse and ping; the OS `prefers-reduced-motion` setting is honoured only where a component uses Tailwind's `motion-reduce:` variant, since `index.css` has no stylesheet-wide media query yet |
| 2.4.1 Bypass blocks | yes | "Skip to content" in `AppShell.tsx`, the first focusable thing on every page |
| 2.4.2 Page titled | partly | Titles exist; not checked page by page |
| 2.4.3 Focus order | not checked | DOM order is reading order by construction |
| 2.4.4 Link purpose | not checked | |
| 2.4.6 Headings and labels | partly | Sections and controls are labelled; the outline per page is not audited |
| 2.4.7 Focus visible | yes | 2 px white outline, 2 px offset, on `:focus-visible` (plan.md §4.7); the skip link gets an indigo one |
| 2.4.11 Focus not obscured (2.2) | not checked | The header is not sticky over content as far as inspection shows |
| 2.5.3 Label in name | not checked | |
| 2.5.7 Dragging movements (2.2) | yes | Nothing requires dragging |
| 2.5.8 Target size minimum (2.2) | partly | Plain mode makes every button, select and input at least 44 px tall (`html[data-plain]`); the default size is not measured against 24 × 24 |
| 3.1.1 Language of page | yes | `<html lang="en">` in `apps/web/index.html` |
| 3.1.2 Language of parts | partly | Greetings (Who's calling?), letter readings (Read It To Me) and spoken warnings (Scam Shield) carry `lang`; other non-English strings on the web are not audited |
| 3.1.5 Reading level (AAA) | yes, for what Tempo says | Flesch ≥ 60 gate on every message family, profile summary and guard message. Web UI copy (labels, headings) is not gated |
| 3.2.3 Consistent navigation / 3.2.4 Consistent identification | yes | One shell (`AppShell.tsx` and `Sidebar.tsx`) on every page |
| 3.2.6 Consistent help (2.2) | yes | Settings, with the accessibility controls, is at the foot of the sidebar on every page; the chat answers "help" with the doors in one plain paragraph |
| 3.3.1 Error identification / 3.3.3 Error suggestion | partly | Gateway errors are plain sentences (an invalid profile import says why, 422); form-level checks are not audited |
| 3.3.7 Redundant entry (2.2) | yes | Nothing is asked twice; memories and profiles carry answers forward |
| 3.3.8 Accessible authentication (2.2) | yes | No password, no puzzle, no transcription. The demo bearer token is configuration (Settings), never typed in a flow; passkeys (Tempo Mesh) are the real authentication and are not wired into this UI yet |
| 4.1.2 Name, role, value | yes | ARIA labels and pressed states on the controls; axe runs on every new page |
| 4.1.3 Status messages | yes | `aria-live="polite"` regions and `role="status"` for chat replies, mission state, the Passport card and the controls |

## Voice and SMS, measured against the same ideas

| Idea | Status |
|---|---|
| Reachable without a screen or an account | yes: a phone number and a text message |
| Patient turn-taking for everyone | yes: `eagerness: patient`, 15 s turns, the prompt forbids interrupting; the whole line, not only for people who asked |
| Adjusts to the caller before the first word | yes in replay and tests; live needs ElevenLabs keys and `make sync-voice` (it switches on the initiation webhook). Six languages have presets (`tempo_core/voice_profile.py:LANGUAGES`); the five non-English greetings are unchecked by native speakers |
| Says key numbers twice for callers with hearing loss | yes: `how_to_speak` tells the agent to; not measurable in replay |
| Offers the question by text when asked | yes: `prefers_text` → `channel_hint: text` |
| One question at a time, read-back on anything unsure | yes |
| Reads a letter to you, in your language, and says what to do by when | yes in replay, from fixtures (`POST /letters/read`, `#/read` and the chat's camera button); live needs a vision key |
| STOP stops everything | yes, on every channel |
| Speaks a language the agent has no preset for | partly: the profile says "They may prefer Somali. Offer to switch if you can, or keep your English short and plain" (`other_language`) |

## How to report an accessibility issue

Open an **Accessibility issue** on GitHub (the template asks for the channel, the barrier, the
assistive technology and, if you know it, the WCAG criterion):
<https://github.com/jeevithg090/Tempo/issues/new/choose>. Accessibility issues are bugs, not
feature requests, and are triaged as such. If the barrier is also a safety matter (Tempo acted
when it should have waited), use [SECURITY.md](../SECURITY.md) instead.

If you cannot use GitHub, tell whoever gave you Tempo's number, or text `HELP` to it; the reply
says how to reach a person.

## What is not yet done

- No audit with a real screen reader user has happened. The checklist is inspection and axe in
  jsdom; axe in a real browser (Playwright) is not wired yet; `tests/e2e/smoke.spec.ts` only
  checks that every page renders its heading.
- `apps/web/src/index.css` has no stylesheet-wide `@media (prefers-reduced-motion: reduce)` or
  `prefers-contrast: more` rule yet; the Reduce motion switch in Settings covers everything, the
  OS setting only what uses Tailwind's `motion-reduce:` variant.
- Speech in is the browser's `SpeechRecognition` (Chrome, Safari); Firefox records a clip and
  the chat says so. Speech out needs `ELEVENLABS_API_KEY` on the Gateway (or a key pasted in
  Settings); otherwise the browser's own voice speaks, and its quality varies by system.
- Each page lands with its axe test (plan.md §4.8); a page still marked "being built" has none yet.
- Colour contrast of accents and badges has not been measured; axe's contrast rule is off in
  jsdom, so it is a manual check for now.
- Non-English text on the web is marked with `lang` only where it is known to appear (greetings,
  letter readings).
- The five non-English greetings have not been checked by native speakers.
- Live voice behaviour (speed, pitch, "say numbers twice") is tested only as configuration; it
  needs ElevenLabs keys to hear.
- There is no Easy Read or BSL version of anything.
- Web UI copy (labels, headings, button text) is not Flesch-gated; only what Tempo says is.
- Target sizes, reflow at 320 px, text spacing and focus order are not measured.
