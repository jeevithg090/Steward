# Tempo's design system ("golden hour")

Tempo gives people their time back, so the interface looks like the hour before dusk:
- An ink canvas.
- Glass surfaces lit from above.
- Violet for the agent and its actions.
- Gold for what was returned.

This page is the reference for anyone adding a page or a component (plan.md §15).

## Tokens (`apps/web/tailwind.config.ts`, `src/index.css`)

| Token | Use |
|---|---|
| `bg-ink` (#07070b), `ink-900…600` | The canvas and the deepest panels. The body already paints the canvas, its aurora and its grain: pages never set a page background. |
| `.surface` | **The default card.** A glass gradient, a hairline border and a soft drop. No blur, so it is cheap in long lists. `Card` uses it. |
| `.glass`, `.glass-strong` | Floating things only: the palette, toasts, sticky bars, popovers. Both blur what is behind them. |
| `violet-*` / `brand-*` | The agent: primary buttons, focus, selection, active navigation, links to act. |
| `gold-200…500`, `.text-gold` | **What came back:** money recovered, hours returned, the ledger. Never decorative. |
| `emerald-*` | Done or paid, and "safe" verdicts. |
| `amber-*` | Waiting: for your OK, or on purpose. |
| `rose-*` | Danger: scams, refusals, errors. |
| `slate-100` / `300` / `400` / `500` | Text: primary, body, secondary, faint. `slate-400` is the lowest for body copy (AA on ink). |
| `border-white/[0.06–0.12]` | Hairlines. Use `0.08` by default. |
| `rounded-3xl` (cards), `rounded-2xl` (inner tiles), `rounded-full` (buttons, pills) | Radii. |
| `shadow-glass`, `shadow-lift`, `shadow-glow`, `shadow-glow-gold` | Depth and emphasis. |
| `.num` | Tabular figures for every number that changes or lines up. |
| `font-display` (Instrument Serif) | Page titles, hero lines, big moments. Not for body or UI labels. |

## Type

| Role | Classes |
|---|---|
| Page title | `PageTitle` (display, 2.35–3rem). Exactly one `h1` per page, and its words are fixed: the tests and screen readers find pages by it. |
| Hero line | `font-display text-4xl sm:text-5xl text-white`, with an *italic* word in `text-gold` or `text-brand` for the payoff ("Your time, *returned*."). |
| Section label | `SectionTitle` (11 px, uppercase, 0.14 em tracking, slate-400). |
| Card title | `text-[15px] font-semibold text-white`. |
| Body | `text-sm leading-relaxed text-slate-300`. Secondary is `text-slate-400`. |
| Big numbers | `Stat` (2 rem, semibold, `.num`, counted up), gold for returned money and hours. |

## Components (`src/components/ui`)

- **`Button` variants:**
  - `primary`: the violet gradient with a glow. One per view, for the main action.
  - `quiet`: glass, for secondary actions.
  - `ghost`: text only.
  - `ok` and `danger`: approving or refusing.
  - `gold`: claiming money.
  - Sizes are `sm` 32 px, `md` 40 px and `lg` 48 px. Plain mode makes every one 44 px or more.
- **`Card`:** a `tone` (`indigo`, `emerald`, `rose`, `amber`, `gold`) tints the glass. `interactive` lifts it on hover, for cards that are links. `padding="tight"` is for rows.
- **`Badge`:** a status pill. `dot` adds a status light. Use `amber` for waiting, `emerald` for done, `rose` for danger, `gold` for money and `indigo` for agent states.
- **`Stat`:** a label, a counted-up value with a prefix and suffix, a tone, and a line under it.
- **`Segmented`:** filters (buttons with `aria-pressed`).
- **`EmptyState`, `Skeleton`/`SkeletonCards`, `Spinner`, `Switch`, `Kbd`, `TempoMark`, `toast`.**

## Page anatomy

1. **`PageTitle`** with the page's name and a one- or two-sentence lede. The `right` slot is for the page's main action.
2. **A hero strip** where the page has numbers: `Stat`s on one `Card`, with the money in gold.
3. **Sections:** a `SectionTitle`, then cards on an 8-px rhythm (`space-y-3` in lists, `gap-4` in grids, `mt-10` between sections).
4. **Lists of things:**
   - A card per item: title, a status `Badge`, one line of plain words (`line-clamp-2`) and quiet metadata.
   - The amount on the right in `text-gold` or white `.num`.
   - A 3-px status rail on the left edge, coloured by state.
5. **Honesty stays visible:**
   - "demo values", "recorded replay" and "simulated company" labels are never hidden or restyled into fine print.
   - Use `Badge tone="amber"` or a `Card tone="amber"` note.

## Motion

- Pages fade up (`animate-fade-up`), and lists stagger (`className="stagger"` on the parent).
- Numbers count up (`Stat`), and dialogs scale in.
- The chat's orb breathes.
- Durations are 150–420 ms with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Reduced motion (the system setting or Settings) turns it all off, and `index.css` enforces that. Never animate layout with JavaScript that ignores it.

## Accessibility rules (do not regress)

- Text contrast meets AA: body text is never below `slate-400` on ink, and white text on filled buttons is at least 4.5:1.
- Focus is visible everywhere: the global `:focus-visible` ring, violet-300.
- Every control has a name. Icon-only buttons have an `aria-label`, and decorative icons have `aria-hidden`.
- Headings, labels, button words and roles that tests or screen readers use stay **word for word**. Restyle freely, but don't rename.
- Status is never colour alone: always a word too (the badge says "Waiting for your OK").
- Plain mode (`html[data-plain]`) and the three text sizes must still lay out (no fixed heights on text).
