# Directory report

Generated 2026-11-10. 1251 packs in `directory/bots/`.

## By category

- Health & fitness (`health`): 112
- Developers & tools (`dev`): 101
- Food & cooking (`food`): 97
- Money & finance (`money`): 95
- Research & learning (`research`): 94
- Email & productivity (`productivity`): 83
- Investing & crypto (`investing`): 74
- Social & creators (`social`): 65
- Work & teams (`work`): 60
- Business & marketing (`business`): 59
- Video & audio (`video-audio`): 55
- Games & fun (`games`): 52
- Home & family (`home`): 49
- Everyday tasks (`misc`): 48
- Build & manage bots (`bot-helpers`): 48
- Travel & cars (`travel`): 46
- Privacy & scams (`privacy`): 40
- Sales & CRM (`sales-crm`): 38
- Sports & fantasy (`sports`): 35

## By author

- AI-made (nvidia/nemotron-3.5-lightning-30b-a3b): 937
- person (LobeChat author): 177
- AI-made (nvidia/nemotron-3-ultra-550b-a55b): 127
- person (OpenBot): 10

## Problems

0 errors, 373 warnings across 233 packs. Warnings do not stop a pack; a reviewer reads them.

- 265 × a sentence is over 35 words
- 97 × uses jargon
- 8 × a health or money bot never sends the person to a professional: lobe-cloze-exercise-generator, lobe-death-anniversary-message, lobe-doctor, lobe-god-bless-you-message, lobe-helps-you-with-your-homework-or-not, lobe-nice-short-sunday-message, lobe-sage-pathfinder, lobe-shaman
- 3 × a starter has a placeholder: lobe-book-summary-agent, lobe-research-assistant

## Generation log

1064 written, 449 dropped.

- 282 × below the bar
- 144 × model failed
- 14 × judge failed
- 1 × duplicate of monthly-budget-builder
- 1 × duplicate of packed-lunch-planner
- 1 × duplicate of birthday-reminder
- 1 × duplicate of email-date-remider
- 1 × duplicate of release-notes-writer
- 1 × duplicate of vendor-delay-reply
- 1 × duplicate of phone-plan-compare
- 1 × duplicate of gestational-diabetes-meal-planner
- 1 × duplicate of robo-advisor-compare

## Toward the launch target

1064 AI-made bots on the shelf, of 2000 planned; 0 retired.
1384 jobs in the taxonomy (224 by people, 1160 proposed by a model and not yet read by a person); 30 without a bot yet.

| Writer                                | Bots | Seconds per bot, one worker (median) | Bots per minute of run time |
| ------------------------------------- | ---- | ------------------------------------ | --------------------------- |
| nvidia/nemotron-3-ultra-550b-a55b     | 127  | 115                                  | 2.8                         |
| nvidia/nemotron-3.5-lightning-30b-a3b | 937  | 33                                   | 4.4                         |

Resume with the same command; it skips jobs that already have a bot or were dropped for good:

```sh
NVIDIA_API_KEY=… STEWARD_SEED_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b \
  STEWARD_SEED_JUDGE_MODEL=nvidia/nemotron-3-ultra-550b-a55b \
  pnpm --filter @steward/bots-gen seed generate --limit 2000 --concurrency 6
```
