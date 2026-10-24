# Delay model backtest (S6.3)

**Data:** SYNTHETIC history (made up, to show the method). Use the live option with HSP keys.

- Route: Oxford → Paddington. Training: 2026-08-29 to 2026-10-16 (1484 runs). Holdout: 2026-10-17 to 2026-10-23 (212 runs), strictly after training.
- Model: P(late ≥ t) per service, shrunk to its hour of day and the hour to the route (empirical Bayes, prior strength from the data).

## Brier score on the holdout week (lower is better)

| Late by at least | Tempo's model | Route average | Improvement | Best possible |
|---|---|---|---|---|
| 15 min | 0.1959 | 0.1970 | 0.6% | 0.1875 |
| 30 min | 0.1113 | 0.1117 | 0.3% | 0.1081 |
| 60 min | 0.0455 | 0.0457 | 0.4% | 0.0446 |

Most of a Brier score is luck that no model can remove; "best possible" (only known for synthetic data) is the score of the true probabilities. One week is a small sample, so expect these numbers to move from week to week.

## What a commuter gets back in the holdout week

Margaret's trains (0812 and 1742, every weekday): 10 journeys, 7 at least 15 min late (the model expected 2.4). GWR Delay Repay on a £28.40 fare, paying the lower edge of each lateness band.

| | Claims | £ back | Her time | Net, at £18/h |
|---|---|---|---|---|
| Never claim | 0 | £0.00 | 0 min | £0.00 |
| By hand | 7 | £149.10 | 84 min | £123.90 |
| With Tempo | 7 | £149.10 | 7 min | £147.00 |

Assumptions: 12 min to claim by hand, 1 min with Tempo (read the question, Face ID); amounts from the GWR rule pack, which still has demo values until checked against GWR's published terms.
