# Scam Shield backtest

*Written by `scripts/scam_train.py` on 2026-10-25T00:34:44+00:00; model version 2026.10.25.
Re-run with `make scam-train`. The plan and the contracts are in [scam-shield.md](scam-shield.md).*

## Data

| Corpus | Messages | Licence | File |
|---|---|---|---|
| UCI SMS Spam Collection (Almeida & Hidalgo, 2012) | 5574 | CC BY 4.0 | `1587ea43e58e…` |
| SMS Phishing Dataset for Machine Learning and Pattern Recognition (Mishra & Soni, 2022) | 5971 | CC BY 4.0 | `9bbf3188fdad…` |
| Synthetic transactional and smishing templates (scripts/scam_synth.py) | 643 | Apache-2.0 (ours; every message made up) | `075422a28d88…` |

11545 messages in all; 5560 exact duplicates (after normalisation) and 0
label conflicts removed; **5985 kept**, of which 946 are
scams (spam or smishing). Split 70/15/15 by message, seed 20261025: 4703 train,
898 validation, 898 test. Every number below is on the **test** fold, which
nothing was fitted on. The classifier is TF-IDF (sub-linear tf, 12000
features) with logistic regression (l2, C=8.0), chosen on validation average precision
(0.9913), then refitted on train+validation; Platt scaling and the zone thresholds were set
on five-fold out-of-fold margins over those 5601 messages.

Attribution: Almeida, T. A. and Hidalgo, J. M. G., *SMS Spam Collection*, UCI Machine Learning
Repository (2012), CC BY 4.0. Mishra, S. and Soni, D., *SMS Phishing Dataset for Machine Learning
and Pattern Recognition*, Mendeley Data, V1 (2022), doi:10.17632/f45bkkt8pr.1, CC BY 4.0.

## Ranking and calibration

| Metric | Value |
|---|---|
| ROC-AUC | 0.9922 |
| Average precision | 0.9858 |
| Brier score (lower is better) | 0.0081 |

Reliability (predicted against observed, ten bins):

| Predicted P(scam) | Messages | Mean predicted | Observed scam share |
|---|---|---|---|
| 0.0–0.1 | 751 | 0.005 | 0.007 |
| 0.1–0.2 | 4 | 0.133 | 0.000 |
| 0.2–0.3 | 2 | 0.256 | 0.000 |
| 0.3–0.4 | 2 | 0.325 | 0.500 |
| 0.5–0.6 | 2 | 0.566 | 0.000 |
| 0.6–0.7 | 1 | 0.625 | 1.000 |
| 0.7–0.8 | 5 | 0.752 | 0.800 |
| 0.8–0.9 | 2 | 0.876 | 1.000 |
| 0.9–1.0 | 129 | 0.997 | 1.000 |

## Zones

`warn` is P ≥ 0.51 (the smallest threshold with precision ≥ 0.98 out of
fold); `quiet` is P ≤ 0.09 (the largest with recall ≥ 0.98 out of fold) and no
link finding; everything between is the `sandbox`. A message with fewer than three words never
reaches `warn` on the model alone. Notes from choosing them:

- thresholds chosen on 5601 out-of-fold messages (train+val, 5 folds)

| Zone | All test messages | Scams | Genuine |
|---|---|---|---|
| warn | 15.5% | 95.8% | 0.4% |
| sandbox | 1.2% | 1.4% | 1.2% |
| quiet | 83.3% | 2.8% | 98.4% |

## What each layer earns

Precision and recall for the scam class on the test fold. "Rules alone" is what a phone with no
model would send to the Gateway (a keyword family, a strong link finding or a big ask); "rules
speak" is what the rules alone would say out loud (a big ask or a brand look-alike link);
"ensemble warn" is what Scam Shield speaks about (the model's warn zone or the rules' speak set);
"flagged" is everything Scam Shield looks at (the warn or sandbox zone, or any rule).

| Layer | Precision | Recall | F1 | False alarms | Missed |
|---|---|---|---|---|---|
| Rules alone (flag) | 100.0% | 10.6% | 0.191 | 0 | 127 |
| Rules alone (speak) | 100.0% | 1.4% | 0.028 | 0 | 140 |
| Model alone, P ≥ 0.5 | 97.8% | 95.8% | 0.968 | 3 | 6 |
| Model warn zone, P ≥ 0.51 | 97.8% | 95.8% | 0.968 | 3 | 6 |
| Ensemble warn (spoken) | 97.8% | 95.8% | 0.968 | 3 | 6 |
| Flagged (looked at) | 92.0% | 97.2% | 0.945 | 12 | 4 |

Smishing (the Mishra & Soni label for texts with a phishing hook) specifically: 100.0%
of smishing texts are in the warn zone and 100.0% are flagged.
1.6% of genuine messages are flagged for a look (most settle silently in the
sandbox; only the warn zone speaks).

## The texts the corpora never saw

The corpora hold almost no genuine transactional texts (a bank's one-time code, an NHS
appointment, a council-tax reminder, a parcel from the real carrier), so a model trained on them
alone reads "formal" as "scam". `scripts/scam_synth.py` writes those kinds from templates, both
genuine and 2026-style scams, declared as synthetic and never mixed into the corpora's test fold.
On the synthetic messages held out of training (129: 78
genuine, 51 scam):

| What | Share |
|---|---|
| Model alone puts a genuine transactional text in the warn zone | 0.0% |
| Scam Shield **speaks** on a genuine transactional text | 0.0% |
| Scam Shield speaks on a synthetic scam | 100.0% |
| Scam Shield flags a synthetic scam for a look | 100.0% |

The speaking rule is the reason the second line is lower than the first: the model may only make
Tempo speak when code already has something concrete to point at (a keyword family or a pressure
sign together with a link that is not the brand's own, a register hit, a feed hit, a big ask). A
genuine council reminder with a `gov.uk` link can score high and still stay silent.

## Limits

- The corpora are English SMS from 2012 and 2022 (Singapore, UK, US and India); 2026 UK-English
  and Hinglish scam texts are not in them. The keyword families and link rules carry that weight.
- "Spam" here includes premium-rate and prize texts, which are tricks for money, and some plain
  marketing, which is not. The ensemble speaks only when the rules or a very high score agree.
- The model never sees the sender, the time or the person's history; the Gateway adds the
  registers, the feeds and the sandbox on top (docs/scam-shield.md §4.3).
