# Rights Decay backtest (R3)

**Data:** 240,144 held-out NYC housing requests (Jul-Dec 2025), a STAND-IN for UK complaints. The planner only saw curves fitted on Jan-Jun.

**Assumptions (not observed):** each problem is owed £32.31 (Ofcom's missed-appointment rate). A closure pays with probability 53% (FCA H1 2026: 56 UK firms upheld 53% of the banking complaints they closed); one that doesn't leaves the problem open. Tempo's call works 85% of the time and costs £0.20. The right to complain ends on day 60. An open problem costs 2 minutes a week of your attention at £18 an hour.

## Per 1,000 problems, closures paying 53% of the time

| Policy | Paid without a fight | Calls Tempo makes | £ back | Your attention | Net |
|---|---|---|---|---|---|
| Never chase | 522 | 0 | £16,878 | 0 h | £16,878 |
| Act at once | 1 | 999 | £27,468 | 0 h | £27,268 |
| Remind at 14 days | 322 | 678 | £29,025 | 54 h | £27,919 |
| Act on the last day | 478 | 522 | £29,778 | 178 h | £26,469 |
| Rights Decay | 271 | 729 | £28,777 | 40 h | £27,915 |

The planner's choice by kind of problem (day, then act or stop chasing): day 7 act, day 10 act.

## Net £ per 1,000 as the share of closures that pay changes

The best simple rule depends on an assumption nobody can see in advance. The planner reads the same assumption and adapts.

| Closures that pay | Never chase | Act at once | Remind at 14 days | Act on the last day | Rights Decay | Planner vs best rule |
|---|---|---|---|---|---|---|
| 25% | £7,959 | £27,266 | £26,939 | £24,171 | £27,288 | +22 |
| 50% | £15,918 | £27,268 | £27,814 | £26,222 | £27,824 | +10 |
| 53% | £16,878 | £27,268 | £27,919 | £26,469 | £27,915 | -4 |
| 75% | £23,877 | £27,270 | £28,689 | £28,272 | £28,851 | +163 |
| 100% | £31,835 | £27,272 | £29,564 | £30,323 | £31,835 | +0 |

A positive gap means the planner beat every simple rule at that share; a negative one is how much it lost to the best of them. Money and minutes here are expected values under the assumptions above, not observed payments.
