# OxHack 2026: "TIME" research and idea shortlist

Compiled on Sat 24 Oct 2026 by 4 research agents. Each finding has a source. ⚠️ marks claims that are uncertain or come from a single or secondary source. Check them before putting them on a slide.

---

## A. Time in everyday life (UK-focused)

| # | Finding | Source |
|---|---|---|
| 1 | UK time use: women do 3h32m of unpaid work a day, men 2h35m. TV takes 2h20m a day | ONS / NatCen 2024: https://natcen.ac.uk/TimeUseStudy |
| 2 | The average UK commute is 58 min a day, about 27 working days a year. Rail commuters average about 2h11m a day ⚠️ year unclear | TUC via https://sundaypost.com/fp/employees-spend-27-days-a-year-getting-to-and-from-work-study-reveals |
| 3 | Only 68.1% of rail station stops were on time (within 1 min) in Jan–Mar 2025. Cancellations were 3.4% | ORR: https://dataportal.orr.gov.uk/media/1i5dwlkv/passenger-performance-jan-mar-2025.pdf |
| 4 | **Only 37% of eligible passengers claim Delay Repay**, and only 31% are told by their operator that they're entitled ⚠️ 2020 data | https://www.globalrailwayreview.com/news/111625/37-per-cent-eligible-delay-refunds-claimed-uk |
| 5 | £22.7bn a year of benefits and social tariffs goes unclaimed in GB (the "time tax" of admin) ⚠️ single advocacy source | https://policyinpractice.co.uk/blog/missing-out-2024-23-billion-of-support-is-unclaimed-each-year |
| 6 | The NHS elective waiting list is 7.33m, with 65.3% seen within 18 weeks against a 92% target ⚠️ check NHS England CSVs | https://www.covermagazine.co.uk/news/4535557/nhs-waiting-list-increases-733m |
| 7 | A&E: 74.9% are seen within 4h against a 95% target, which hasn't been met since 2013/14. In Dec 2024, 1 in 8 waited 12h+ | https://www.healthwatch.co.uk/response/2025-01-09/pressures-ae-new-nhs-performance-data |
| 8 | Only 52.9% find it easy to phone their GP (the "8am scramble") | https://www.ipsos.com/en-uk/2025-gp-patient-survey-results-released |
| 9 | UK consumers spend about 445m hours a year on hold ⚠️ vendor survey | https://www.comparethecloud.net/news/uk-consumers-lose-445-million-hours-a-year-on-hold-servicenow-research-finds |
| 10 | **When the clocks go back** (which happens *during* OxHack, at 02:00 on 25 Oct): pedestrian deaths around 6pm rose 186% per mile ⚠️ US data from 2007. Hospital contacts for depressive episodes rose 11% in Denmark | https://bikepgh.org/2007/11/03/pedestrians-3-times-more-likely-to-be-killed-when-clocks-change-study-says · https://neurosciencenews.com/depression-time-change-5384/ |
| 11 | Fatal crashes rise about 6% in the week after the spring clock change. The heart-attack effect is disputed | https://www.colorado.edu/today/node/37013 |
| 12 | Psychology of waiting (Maister): waits feel shorter when you're occupied, and longer when they're unexplained or you're anxious | https://davidmaister.com/blog/201/The-Psychology-of-Waiting-Lines.html |

**Data and APIs:** TfL Unified API (free key, live station crowding every 5 min), ORR data portal, NHS England monthly CSVs for A&E and elective waits, National Rail Darwin (register early).

## B. Time lost at the computer

| # | Finding | Source |
|---|---|---|
| 1 | **METR RCT (2025):** experienced developers were **19% slower** using AI tools, yet *believed* they were 20% faster. About 9% of their time went to reviewing or cleaning AI output and about 4% to waiting on it | https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ |
| 2 | **METR follow-up (Feb 2026):** late-2025 tools showed roughly 18% speedup ⚠️ wide error margins. Developers running **several AI agents in parallel made time impossible to track.** Nobody measures time spent waiting on agents well | https://metr.org/blog/2026-02-24-uplift-update/ |
| 3 | Parnin: programmers got back to code within 1 minute of an interruption in only 10% of sessions. It typically takes 10–15 minutes to start editing again | https://sites.cc.gatech.edu/reverse/repository/resumptionstrategies.pdf |
| 4 | Gloria Mark: on average, people return to an interrupted task after 23 min 15 s | https://news.gallup.com/businessjournal/23146/Too-Many-Interruptions-Work.aspx |
| 5 | Attention on a single screen fell from about 2.5 min (2004) to about 47 s | https://ics.uci.edu/2023/01/12/cnn-your-attention-span-is-shrinking-studies-say-heres-how-to-stay-focused/ |
| 6 | Microsoft 2025: workers are interrupted about every 2 minutes, roughly 275 times a day ⚠️ secondary source | https://www.axios.com/2025/06/17/microsoft-remote-work-meetings |
| 7 | Atlassian 2025: 50% of developers lose 10+ hours a week to friction. They spend only 16% of their time coding | https://www.atlassian.com/blog/developer/developer-experience-report-2025 |
| 8 | **Doherty (IBM, 1982):** cutting response time from 3 s to 0.3 s roughly **doubled** productivity, from 180 to 371 transactions an hour | https://archive.computerhistory.org/resources/access/text/2024/03/102751398-05-01-acc.pdf |
| 9 | Google: adding 100–400 ms of delay reduced searches per user by 0.2–0.6%, and the effect lasted after the delay was removed | https://research.google/blog/speed-matters/ |
| 10 | People can tell **1 ms from 2 ms** of latency when dragging, yet typical devices run at 65–120 ms | https://webdocs.cs.ualberta.ca/~wfb/publications/C-2014-SIGCHI-Latency.pdf |
| 11 | Response-time limits: 0.1 s feels instant, 1 s keeps your flow, and at 10 s you lose attention | https://www.nngroup.com/videos/3-response-time-limits-interaction-design/ |

## C. Time inside computer systems

| # | Finding | Source |
|---|---|---|
| 1 | MSR 2025: 151 date/time bugs in Python projects. **Time zones are the #1 cause**, and most fixes are a few lines | https://2025.msrconf.org/details/msr-2025-technical-papers/35/ |
| 2 | Cloudflare, 2017: a leap second made a measured duration negative, the DNS server crashed, and about 0.2% of DNS queries failed. **The fix was 1 character** (use a monotonic clock) | https://www.theregister.com/2017/01/04/cloudflare_trips_over_leap_second/ |
| 3 | Linux, 2012: a leap second caused a loop that pinned Java, MySQL and Firefox at 100% CPU worldwide | https://lkml.iu.edu/hypermail/linux/kernel/1207.0/00026.html |
| 4 | Zune, 31 Dec 2008: every Zune 30GB froze, because of a day-366 infinite loop | https://en.wikipedia.org/wiki/Zune_30 |
| 5 | Year 2038: Debian 13 moved to 64-bit time and rebuilt more than 1,200 packages. Embedded systems are still exposed | https://www.theregister.com/2025/07/25/y2k38_bug_debian/ |
| 6 | Huygens (NSDI 2018) synchronises clocks to within tens of nanoseconds in software; NTP manages about 1 ms. Meta's switch from NTP to PTP improved accuracy about 100x | https://www.usenix.org/conference/nsdi18/presentation/geng · https://engineering.fb.com/2022/11/21/production-engineering/precision-time-protocol-at-meta/ |
| 7 | rr record-and-replay adds only about 1.5x overhead | https://arxiv.org/abs/1705.05937 |
| 8 | TigerBeetle's deterministic simulator: 1 day of simulation ≈ 2 years of real-world testing | https://tigerbeetle.com/blog/2023-07-11-we-put-a-distributed-database-in-the-browser |
| 9 | Speculative decoding gives a 2–3x speedup with identical output. Stadia's "negative latency" claim never visibly shipped | https://proceedings.mlr.press/v202/leviathan23a · https://www.engadget.com/2019-10-10-google-stadia-negative-latency.html |

## D. Time × AI × prediction

| # | Finding | Source |
|---|---|---|
| 1 | "Lost in Time" (2025): the best multimodal model read analog clocks correctly only 22.6% of the time (GPT-4o 8%) ⚠️ only 62 clocks | https://arxiv.org/html/2502.05092v1 |
| 2 | ClockBench leaderboard *today*: humans 90.7%, top model 83.3%, GPT-4o and Claude Sonnet 4 at 6.7%. Frontier models have mostly caught up | https://clockbench.ai |
| 3 | Video event order (Vinoground): GPT-4o about 50% (close to chance), humans about 90% | https://arxiv.org/abs/2410.02763 |
| 4 | Time-series foundation models, zero-shot: Chronos-2 ranks first and TimesFM-2.5 second. Chronos-Bolt is 250x faster and runs on a laptop CPU | https://arxiv.org/pdf/2510.15821 · https://aws.amazon.com/blogs/machine-learning/fast-and-accurate-zero-shot-forecasting-with-chronos-bolt-and-autogluon/ |
| 5 | **Bolting an LLM onto time-series forecasting adds nothing** (NeurIPS 2024). Use a real forecasting model | https://arxiv.org/abs/2406.16964 |
| 6 | **ForecastBench (Jan 2026):** the best AI forecaster trails human superforecasters by only 0.017 Brier. The projected crossover is **Nov 2026, i.e. next month** | https://forecastingresearch.substack.com/p/llms-are-closing-the-gap-on-human |
| 7 | Metaculus: the gap between human pros and AI bots shrank from −20 (significant) to −1.25 (not significant) | https://www.lesswrong.com/posts/wZBbDqzfBjYG58CxK/futureeval-spring-results-pros-beat-bots-but-the-gap-is |
| 8 | Centaur (Nature 2025): an LLM fine-tuned on 10.7M human decisions predicts people better than classical cognitive models | https://ideas.repec.org/a/nat/nature/v644y2025i8078d10.1038_s41586-025-09215-4.html |

---

## Idea shortlist (built on the findings above)

1. **Pre-Cog: software that answers before you finish.** This is speculative execution applied to humans. The software predicts your next action and runs it in advance: your next edit, test run, or the end of your sentence. Wrong guesses are thrown away invisibly. A handmade **Photon Clock** rig (a solenoid presses the key, a photodiode on the screen detects the change, and an Arduino times it in µs) *proves* the latency goes below zero. Based on: B8, B9, B10, C9. Prizes: Zed (speed is 30% of judging), HRT (prediction and decision-making), Citadel (handmade), ElevenLabs.
2. **Time Machine Forecaster.** An AI forecasting agent that is only allowed to see information from *before* date T. A rewind slider lets you watch its reasoning, then reveals what actually happened, all scored against human crowds. Test the claim that AI will match superforecasters next month. Based on: D6, D7. Prizes: HRT (exact fit), Gemini, Snowflake.
3. **The Hour That Happens Twice: a fuzzer for time bugs.** It lies to programs about the time (leap seconds, daylight saving jumps, 2038, Feb 29). It replays the real Cloudflare and Zune bugs, and runs live while the clocks go back at 02:00 tonight. Based on: C1–C5. Prizes: theme, Zed, HRT (systems).
4. **Pulse Futures.** A camera reads your heart rate (Presage), the data is stored in Tiger Data, and Chronos forecasts your heart 60 seconds ahead with confidence bands. A voice warns you *before* a spike. Based on: D4, D5. Prizes: HRT, Tiger Data, Presage, ElevenLabs.
5. **Agent-Wait Choreographer.** It predicts when each AI agent or CI job will finish, decides whether a task switch is worth it, and pulls you back with a resume card. This tackles the problem METR said nobody measures. Based on: B1–B4. Prizes: Zed, HRT, Tiger Data.
6. **Reclaim.** Your journeys are matched against train-running data to find the Delay Repay compensation you're owed, and the claim is drafted automatically. 63% of eligible passengers don't claim. Based on: A3, A4. Prizes: HRT, Tiger Data, Gemini. Real UK money.

---

# Part 2: AI agents × time × everyday life (research round 2)

## E. What still breaks agents (the open gaps)
| # | Finding | Source |
|---|---|---|
| 1 | **Reliability collapses when a task is repeated.** GPT-4o solved about 61% of retail tasks once, but fewer than 25% on all 8 attempts | https://arxiv.org/pdf/2406.12045 |
| 2 | The best agent fully completes only 30% of 175 realistic office tasks | https://arxiv.org/abs/2412.14161 |
| 3 | CRM agents fall from about 58% success on single-turn tasks to about 35% on multi-turn. **About half of the failures happen because the agent never asked for missing information** | https://arxiv.org/abs/2505.18878 |
| 4 | **Approval fatigue.** Auto-approve use rises from about 20% of sessions to over 40% as people get used to agents | https://www.anthropic.com/research/measuring-agent-autonomy |
| 5 | **No undo for agent actions.** Replit's agent dropped a production database and then said rollback was impossible. Enterprise rollback tools "don't unsend emails" | https://www.bytebase.com/blog/how-to-prevent-ai-agent-from-dropping-your-production-database |
| 6 | **Prompt injection is still unsolved.** Comet leaked credentials and one-time codes through hidden page text | https://brave.com/blog/unseeable-prompt-injections |
| 7 | **Agents are blind to time.** With only a global deadline, GPT-5.1 closed 4% of deals; with updates on remaining time, it closed 32%. LLMs misjudge how long their own work takes by 5–10x | https://arxiv.org/abs/2601.13206 · https://arxiv.org/html/2604.00010v1 |
| 8 | **Agents barely exist outside coding.** About 50% of agent tool calls are software engineering | https://www.anthropic.com/research/measuring-agent-autonomy |
| 9 | Gartner expects more than 40% of agentic AI projects to be cancelled by 2027. MIT NANDA found 95% of GenAI pilots showed no measurable return ⚠️ narrow definition of return | https://www.newelectronics.co.uk/content/news/over-40-of-agentic-ai-projects-could-be-cancelled-by-2027 |

## F. Agent speed
| # | Finding | Source |
|---|---|---|
| 1 | A computer-use agent took **12 minutes** to change line spacing, a task a person does in 30 seconds. **75–94% of the time goes to the LLM planning and reflecting** | https://arxiv.org/html/2506.16042v1 |
| 2 | Agents take 1.4–2.7x more steps than a person | https://arxiv.org/abs/2506.16042 |
| 3 | LLMCompiler (running independent tool calls in parallel): up to 3.7x lower latency and 6.7x lower cost than ReAct | https://arxiv.org/abs/2312.04511 |
| 4 | Agentic Plan Caching (reusing earlier plans): 50% less cost and 27% less latency, with accuracy kept | https://arxiv.org/abs/2506.14852 |
| 5 | Speculative Actions (a cheap model guesses the next action while the main model works): about 20% wall-time saved, and guesses are right up to 55% of the time. **A modest gain** | https://arxiv.org/html/2510.04371v1 |
| 6 | Prompt caching: up to 85% lower latency on long prompts | https://www.anthropic.com/news/prompt-caching |
| 7 | Record-and-replay compilers claim 34–399x speedups ⚠️ vendor claim | https://pypi.org/project/terx/0.3.1/ |

## G. Frontier techniques
| # | Finding | Source |
|---|---|---|
| 1 | Skill induction (ASI): turns successful runs into verified functions. **+23.5% success with 10–15% fewer steps** | https://arxiv.org/abs/2504.06821 |
| 2 | Agent Workflow Memory: +51.1% relative success on WebArena | https://arxiv.org/abs/2409.07429 |
| 3 | Darwin Gödel Machine (an agent that rewrites its own code): SWE-bench score went from 20% to 50% | https://arxiv.org/abs/2505.22954 |
| 4 | Behavior Best-of-N (several full attempts, a judge picks the best): OSWorld 62.6% → 69.9%, against 72% for humans | https://arxiv.org/abs/2510.02250 |
| 5 | AlphaEvolve: found a 4×4 complex matrix multiplication with 48 multiplications, and recovers about 0.7% of Google's compute ⚠️ second figure is secondary | https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/ |
| 6 | **Multi-agent setups often fail.** On sequential tasks, all multi-agent variants scored 39–70% worse than a single agent | https://arxiv.org/abs/2512.08296 |
| 7 | Standard benchmarks are close to saturated (SWE-bench Verified about 96%, OSWorld-Verified about 85% against 72% for humans) ⚠️ aggregator figures. **What stands out now is measured speed, cost and reliability** | benchlm.ai |

## H. Where demand is (hours lost)
| # | Finding | Source |
|---|---|---|
| 1 | US prior authorisation: 39 requests per physician per week, costing 13 hours | https://www.ama-assn.org/practice-management/prior-authorization/fixing-prior-auth-nearly-40-prior-authorizations-week-way |
| 2 | Clinical documentation: AI scribes cut EHR time by only 8.5%. **The UK market is crowded** (19 approved NHS suppliers) | https://www.healthcare-management.uk/ambient-voice-technologies-enthusiasm-informed-adoption |
| 3 | Salespeople spend 70% of their time on non-selling work ⚠️ self-reported | https://www.salesforce.com/news/stories/sales-ai-statistics-2024/ |
| 4 | 25% of work time is spent searching for answers | https://www.atlassian.com/blog/state-of-teams-2025 |
| 5 | NHS: 15.4 million missed GP appointments a year (about £216m). An estimated 11.8 million missed hospital appointments (£1.9bn) ⚠️ vendor extrapolation | https://buildingbetterhealthcare.com/how-clearer-communication-could-save-the-nhs-1-9 |
| 6 | A systematic review takes a mean of 67.3 weeks with 5 authors | https://bmjopen.bmj.com/content/7/2/e012545 |

## Already exists, so don't clone
- **Browsers and computer use:** ChatGPT agent/Atlas, Comet, Chrome auto browse, Claude for Chrome, Browser Use, Skyvern
- **Coding agents:** Claude Code, Codex, Cursor, Devin
- **General agents:** Manus (bought by Meta)
- **Workflow automation:** Zapier, Lindy, n8n
- **Phone calls:** **Gemini "Call for Me"**, which waits on hold for you
- **Calendars:** Reclaim, Motion, Clockwise
- **Memory:** Mem0, Zep
- **Record and replay:** muscle-mem, TERX
- **Enterprise rollback:** Rubrik Agent Rewind
- **Meeting notes:** Granola
- **AI scribes:** 19 NHS suppliers

## Final shortlist: research-level everyday-life agents
1. **Chronos: an agent that previews the future and rewinds the past.** It is a life-admin agent for email, calendar and forms.
   - It runs every task first on a shadow copy (a "dry run").
   - It shows one readable change list ("sends 3 emails, moves 2 meetings").
   - It asks questions only where 5 parallel runs disagree.
   - It commits, keeps an undo log, and gets faster each time by compiling skills.
   - It targets gaps E1, E3, E4, E5, E6 and E8, building on techniques G1 and G4.
2. **NHS Slot Rescue.** A no-show predictor trained on Kaggle's 110k appointments, plus a voice agent that rebooks patients and fills freed slots from a waitlist. It targets H5 and covers the HRT, ElevenLabs and Tiger Data prizes.
3. **Déjà Vu.** A life-admin agent that compiles each task into a skill, so the first run takes 90s and later runs take 4s, and it repairs itself when a site changes. It targets F1 and builds on G1 and G2. Crowded-ish.
4. **Time-aware agent runtime.** It gives an agent a clock, calibrated ETAs and deadline budgets, always keeping a best-so-far answer. It targets E7.

---

# Part 3: Social impact: people that technology leaves behind (research round 3)

## I. UK digital exclusion
| # | Finding | Source |
|---|---|---|
| 1 | About 2.2m UK adults are fully offline and 8m lack basic digital skills. 66% of offline people are 65+, and they are 2.5x more likely to be on a low income ⚠️ | https://www.goodthingsfoundation.org/policy-and-research/research-and-evidence/research-2024/digital-nation |
| 2 | 4.7m over-65s can't do all 8 basic online tasks, which include logins and passwords. 2.3m never use the internet | https://www.ageuk.org.uk/latest-press/articles/2024/more-than-1-in-3-over-65s-4.7-million-lack-the-basic-skills-to-use-the-internet-successfully/ |
| 3 | 31% of over-60s (5.1m) say life is "much harder" because services moved online, and 64% rely on family or friends | https://www.ageuk.org.uk/latest-press/articles/one-in-three-31-over-60s-say-life-is-harder-than-five-years-ago-because-more-services-are-now-online/ |
| 4 | 81% of people who don't use the internet see "no need", and "too complicated" (21%) outranks cost (14%). **So the answer is a better proxy, not more app training** ⚠️ | https://www.ispreview.co.uk/index.php/2025/05/ofcom-find-internet-access-levels-in-the-uk-remain-stable-in-2024.html |
| 5 | 18% of adults in England (about 6.6m) have low literacy and 21% low numeracy (PIAAC 2023) | https://www.gov.uk/government/publications/survey-of-adult-skills-2023-national-report-for-england |
| 6 | **About 27% of households sent a "move to Universal Credit" letter didn't claim in time, so their benefits stopped** | https://www.benefitsandwork.co.uk/news/over-a-quarter-of-uc-migrations-have-failed-so-far |
| 7 | £24.1bn a year of benefits and social tariffs goes unclaimed ⚠️ | https://policyinpractice.co.uk/publication/missing-out-2025 |
| 8 | HMRC callers wait about 23 minutes on average, and **callers spent 798 years on hold** in 2022-23 | https://www.nao.org.uk/press-releases/taxpayers-let-down-by-poor-hmrc-customer-service/ |
| 9 | 1 in 3 people over 75 could only book GP appointments online, and 63% say this makes them feel more isolated | https://www.digitalhealth.net/2026/05/older-people-isolated-due-to-online-gp-bookings-push-survey-finds/ |
| 10 | Being offline means paying up to 25% more for essentials (the "poverty premium") | https://www.centreforsocialjustice.org.uk/wp-content/uploads/2023/08/CSJ-Left-Out.pdf |
| 11 | About 1.04m people in England and Wales can't speak English well or at all | https://fullfact.org/immigration/farage-how-many-people-cant-speak-english/ |
| 12 | Older people say "I sometimes feel really, really, embarrassed to ask somebody" (Age UK) | Age UK, as above |

## J. Scams
| # | Finding | Source |
|---|---|---|
| 1 | 4.2M fraud incidents in England and Wales in the year to March 2025, **up 31%** | https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/articles/natureoffraudandcomputermisuseinenglandandwales/yearendingmarch2025 |
| 2 | Authorised push payment (APP) fraud, where victims are tricked into sending money themselves, cost £576M across 248k cases in 2025 ⚠️ secondary source | https://www.financialplanningtoday.co.uk/news/crooks-steal-£1-3bn-through-payment-fraud |
| 3 | **71% of victims don't know** banks must now reimburse APP fraud (88% of in-scope losses were reimbursed) | https://finreg.aoshearman.com/psr-update-on-impact-of-app-fraud-reimbursement-s |
| 4 | Courier fraud: average loss £15,311, and **62% of victims are aged 76–96** | https://www.suffolk.police.uk/news/suffolk/news/news/2026/june/over-70s-targeted-as-national-courier-fraud-losses-total-21-million/ |
| 5 | AI voice clones: 28% of people say they were targeted, and 46% had never heard of the scam ⚠️ survey | https://starlingbank.com/news/starling-bank-launches-safe-phrases-campaign |
| 6 | **Time pressure increases susceptibility to scams that threaten a loss** (bank account, arrest, HMRC fine) | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1508363/pdf |
| 7 | **A human pause works.** The Banking Protocol, where branch staff step in during a suspicious withdrawal, prevented £174M; the average person helped was 71 | https://www.ukfinance.org.uk/blogs/benefits-banking-protocol |
| 8 | Google's live call scam detection works only on Pixel 9 or newer, in English, French and Hindi, and not on landlines | https://blog.google/security/new-ai-powered-scam-detection-features/ |
| 9 | QR code scams in car parks: 784 reports and about £3.5M lost | https://www.thebureauinvestigates.com/stories/2025-06-27/quishing-new-qr-code-scam-sweeps-uk-car-parks |
| 10 | India: "digital arrest" scams cost ₹1,935 crore in 2024. UPI payment fraud: 12.6 lakh cases worth ₹981 crore in FY25 | https://inc42.com/?p=504907 |
| **Gap** | **Defences act before the call (blocking) or after the money is gone (refunds). Nothing helps in the 5–60 minutes the victim is on the phone and panicking** | |

## K. Low literacy worldwide
| # | Finding | Source |
|---|---|---|
| 1 | **739M adults lack basic literacy, about two-thirds of them women** | https://www.unesco.org/sites/default/files/medias/fichiers/2025/09/ild-2025-factsheet.pdf |
| 2 | 3.1B people have mobile internet coverage but don't use it | https://gsma.com/newsroom/press-release/gsma-calls-for-renewed-focus-on-closing-the-usage-gap-as-more-than-3-billion-people-remain-offline-despite-available-mobile-internet-services/ |
| 3 | PM-KISAN (India's farmer income scheme): 4.8M farmers had payments withheld over incomplete identity checks (e-KYC) | https://thewire.in/rights/ekyc-failures-leave-millions-of-farmers-cut-off-from-pm-kisan-payments |
| 4 | 42% of rural workers needed more than 4 hours to withdraw wages, often over several visits (2018-19 data) | https://ruralindiaonline.org/en/library/resource/length-of-the-last-mile-delays-and-hurdles-in-nrega-wage-payments |
| 5 | 1 in 5 Indian families who use UPI have been hit by fraud. 40% of victims tapped a "receive money" link that actually took money | https://thelogicalindian.com/1-in-5-indian-upi-users-hit-by-fraud-since-2022-survey-rbi-npci-launch-new-safeguards-from-june-30/ |
| 6 | Low-literacy users were up to 10x more accurate with a live human operator than with text interfaces | https://www.microsoft.com/en-us/research/?p=161317 |
| 7 | **Prior art:** FormBharo (a Hindi voice agent for filling forms) found that speech recognition errors cut form completion by up to 41 points. **Use deterministic guardrails** | https://arxiv.org/abs/2608.06027 |

## L. What existing tools miss
- **Be My Eyes, Seeing AI and Lookout:** they describe or read text word for word. They don't explain it, extract deadlines, or hand off to a helper.
- **AbilityNet:** helps by phone 9–5 on weekdays only.
- **Jugalbandi:** answers "what is this scheme", not "why did my payment stop".
- **Gemini Live and ChatGPT voice:** already do "point your camera and ask". **What a new tool can add is design for these users: deadline first, grounded in the letter, teach-back, helper handoff, and working by phone.**
- **Risk of over-trust:** blind users trust AI descriptions more than human ones, and GOV.UK Chat's accuracy fell short while users trusted its brand.
- **Teach-back** (asking people to restate what they understood) improves understanding.

## Final concept: "Pause": real deadlines vs. fake deadlines
Vulnerable people face two kinds of pressure from time:
1. **Real deadlines they can't read.** For example, 27% of Universal Credit migration letters went unanswered and the benefits stopped.
2. **Fake deadlines invented by scammers.** For example, "pay within 2 hours or be arrested".

Pause handles both. You photograph a letter or text, or (as a stretch goal) call it from a basic phone. It answers in your language:
- **Real:** who sent it, what they want, by when, what happens if you ignore it, and the exact line in the letter it read this from. Then a teach-back check, a reminder, and a card sent to your helper.
- **Scam:** the red flags it found, a cooling-off pause, a call to your trusted contact, and "call your bank on the number on your card."
