# Accessibility

Steward is for people who have more to do than time, attention or energy to do it with. That
includes people who use a screen reader, a keyboard, a switch, voice, magnification or plain
language. Every path through the app works without a mouse, and the agent can be spoken to and can
speak back.

We aim for [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. This page says what is built, how
to test it, and what is not there yet. If something gets in your way, please
[open an issue](../CONTRIBUTING.md#reporting-a-bug); accessibility bugs are treated as bugs, not
as feature requests.

## What is built

### Structure

- **A skip link,** "Skip to main content", is the first thing Tab reaches on every page.
- **Landmarks:** one `main`, a navigation labelled "Main", the demo-data notice as a labelled
  complementary region, and labelled regions for each card (the brief, an approval, the rule tester).
- **One `h1` per page,** and headings in order below it, so the headings list is a table of contents.
- **Focus follows navigation.** After moving to another page, focus goes to its heading, so a screen
  reader announces where you arrived, and the browser tab's title changes to match ("Rules ·
  Steward"). A page with nothing to focus falls back to `main`.
- **Live regions** are mounted before anything arrives in them: the conversation is a `log`, so new
  replies are read out as they come; the "waiting on you" banner announces a new approval; results
  of a check and errors use `status` and `alert`.

### Keyboard

- Everything can be reached and used with the keyboard, in a sensible order.
- **Focus is always visible:** a solid outline in the accent colour, thicker in high contrast.
- **Shortcuts,** in the style of Gmail and GitHub: press `g`, let go, then a letter. They never fire
  while you are typing, and never use keys a screen reader or the browser needs.

| Keys    | Goes to               |
| ------- | --------------------- |
| `g` `t` | Today                 |
| `g` `c` | Chat                  |
| `g` `k` | Tasks                 |
| `g` `o` | Computer              |
| `g` `u` | Routines              |
| `g` `r` | Rules                 |
| `g` `l` | Record                |
| `g` `s` | Settings              |
| `?`     | The list of shortcuts |
- In the composer, Enter sends and Shift+Enter starts a new line. Typing `/` opens the list of
  skills, which arrow keys move through.

### Seeing

Settings → Accessibility, saved in this browser and applied before the page first paints, so a
setting never flashes the default first:

| Setting   | Choices                           | What it does                                                              |
| --------- | --------------------------------- | ------------------------------------------------------------------------- |
| Text size | Standard (100%), 115%, 130%, 150% | Scales all text and the layout with it. Browser zoom works too.           |
| Contrast  | Standard, More                    | Stronger text, borders and focus rings, and no translucent surfaces.      |
| Theme     | System, Light, Dark               | Follows the system by default, and changes with it.                       |
| Font      | Default, Readable                 | A high-legibility face with wider letter spacing.                         |
| Motion    | System, Reduce                    | No animation. The system's reduced-motion setting is honoured either way. |

Touch and click targets are at least 44 by 44 CSS pixels. Colour is never the only signal: every
status has a word and an icon beside its colour.

### Hearing and speaking

- **Read aloud.** Steward can read its replies aloud with the browser's own speech synthesis.
  Nothing leaves your device for this. A Stop button silences it.
- **Dictation.** The microphone button in the composer takes your message by voice, with the
  browser's speech recognition. Some browsers, Chrome among them, send the audio to their own
  speech service to recognise it; the composer says so beside the button. Where a browser has no
  speech recognition, the button explains instead of doing nothing.

### Understanding

- **Plain language** (Settings) asks Steward to use short sentences and everyday words. It applies
  to the agent's replies, and the app's own copy is written that way already.
- **Every approval says exactly what will happen,** in one sentence, before the details: "Send an
  email to sam@example.com: 'Friday'". The details are one tap away.
- **Errors say what happened and what to do,** in words, never as a code alone.
- **Demo data is labelled** on every page, so made-up mail is never mistaken for real mail.

### The agent's screen

The live view of the agent's browser is a picture, and pictures are hard to use without sight. So:

- The screen has a name that says who is driving: "Steward's computer, live. Steward is driving."
- The **Activity** list beside it says in words what the agent did: "Opened news.ycombinator.com",
  "Clicked 'More'", "Saved report.md".
- Every action the agent takes also appears as a card in the conversation.
- **Take the wheel** gives you the keyboard and mouse on that screen. While you hold it, the screen
  is an application region that passes your keys straight through, with instructions read out on
  focus; Escape is never trapped.

## How to test

### With a keyboard only

1. Load Today. Press Tab once: "Skip to main content" appears. Press Enter, then Tab: focus lands
   in the page, not the navigation.
2. Tab through every page. Every stop shows a visible outline, nothing is skipped, and nothing traps
   focus. Dialogs keep focus inside until closed, close with Escape, and return focus to what
   opened them.
3. In Chat, send "Email sam@example.com about Friday: see you at 10" with the scripted model. Reach
   **Refuse** and **Allow once** with Tab and answer with Enter or Space.
4. On Rules, add a rule and use the tester without the mouse.

### With VoiceOver (macOS, Safari or Chrome)

1. Turn it on with Cmd+F5. Open Steward.
2. VO+U opens the rotor. Check **Landmarks** (main, the Main navigation, the demo-data notice) and
   **Headings** (one level 1, then the sections in order).
3. Move between pages with the navigation. On each one, VoiceOver should announce the new page's
   heading without you moving.
4. In Chat, send a message and keep your hands off the keyboard: the reply is read out as it
   arrives. When an approval card appears, the banner announces it.
5. On Record, check that each entry reads as one sentence with its outcome.

### With NVDA (Windows, Firefox or Chrome)

1. Start NVDA. Open Steward in browse mode.
2. Press D to move between landmarks and H between headings; Insert+F7 lists both.
3. Press F to move between form fields on Rules and Settings: every field has a name, and errors
   are read with the field.
4. In Chat, NVDA switches to focus mode in the composer. Send a message; the reply is announced
   from the conversation log.
5. With Windows High Contrast (forced colours) on, every control and focus outline is still visible.

### Zoom and reflow

- At 200% browser zoom, nothing overlaps and nothing is cut off.
- At a width of 320 CSS pixels (or 400% zoom on a 1280 pixel screen), the layout becomes the phone
  layout with a bottom bar, and nothing needs scrolling sideways except tables, which scroll on
  their own.
- With Text size at 150%, the same holds.

### Automated checks

`pnpm e2e` runs `tests/e2e/a11y.spec.ts` against the real app: the skip link, the landmarks, one
`h1` on every page, a visible focus indicator on every Tab stop, and the text size setting. With
`@axe-core/playwright` installed it also runs axe on the main pages and fails on any serious or
critical violation. Biome's accessibility lint rules run on every `pnpm check`.

Automated checks find perhaps a third of real problems. The manual passes above are the ones that
matter.

## Not there yet

- The live screen of the agent's browser cannot be explored with a screen reader; the Activity list
  and the conversation are the accessible way to follow what the agent does.
- Voice in depends on the browser's speech recognition, which not every browser has, and which may
  send audio to the browser maker.
- No right-to-left layout, and the interface is in English only.
- No automated contrast check in CI for tenant accent colours; a tenant package must pick an accent
  with enough contrast itself (see [make-it-your-own.md](make-it-your-own.md#brandyaml)).
