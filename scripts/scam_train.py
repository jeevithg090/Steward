# ruff: noqa: E501  (long report rows and f-strings read better on one line)
"""`make scam-train`: Scam Shield's text model from two open SMS corpora, shipped as data.

Downloads (once, into .data/scam/, gitignored) the UCI SMS Spam Collection (Almeida & Hidalgo,
2012; 5,574 messages, ham/spam) and the SMS Phishing Dataset for Machine Learning and Pattern
Recognition (Mishra & Soni, Mendeley Data, 2022; 5,971 messages, ham/spam/smishing). Both are
CC BY 4.0; the attribution travels in the model file and in docs/scam_backtest.md.

Then: de-duplicate on the normalised text (the second corpus grew out of the first), split
70/15/15 by message with a fixed seed, build exactly the tokens `tempo_core.scam_model.tokens`
builds (so the phone and the Gateway see what the trainer saw), fit TF-IDF plus logistic
regression (L1 and L2, a C grid, chosen on validation average precision), calibrate with Platt
scaling on the validation fold, pick the zone thresholds on the validation fold (warn: precision
at least 0.98; quiet: recall at least 0.98), report on the untouched test fold, and write
skills/scam-shield/model.json, fixtures/signals/model_vectors.json and docs/scam_backtest.md.
The export is checked by loading it back through `tempo_core.scam_model` and comparing
probabilities with scikit-learn's on the test fold.

Run: uv run --with scikit-learn python -I scripts/scam_train.py   (about a minute)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import warnings
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split

from tempo_core.links import find_links
from tempo_core.scam import BIG_ASKS, pressure_signs
from tempo_core.scam_model import NORMALISER, ScamModel, normalise, tokens
from tempo_core.signals import fired_families, load_signals

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scam_synth import Synthetic, split, synthetic

warnings.filterwarnings("ignore", category=FutureWarning)  # scikit-learn's penalty rename
warnings.filterwarnings("ignore", category=UserWarning)
REPO = Path(__file__).resolve().parents[1]
DATA = REPO / ".data" / "scam"
MODEL = REPO / "skills" / "scam-shield" / "model.json"
VECTORS = REPO / "fixtures" / "signals" / "model_vectors.json"
REPORT = REPO / "docs" / "scam_backtest.md"
SEED = 20261025
PRECISION_FLOOR = 0.98  # the warn zone must be this precise on validation
RECALL_FLOOR = 0.98  # the quiet zone must keep this much recall on validation
LINK_THRESHOLD = 0.20

UCI = {
    "name": "UCI SMS Spam Collection (Almeida & Hidalgo, 2012)",
    "url": "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip",
    "file": "uci/sms_spam_collection.zip",
    "licence": "CC BY 4.0",
    "cite": "https://archive.ics.uci.edu/dataset/228/sms+spam+collection",
}
MENDELEY = {
    "name": "SMS Phishing Dataset for Machine Learning and Pattern Recognition "
    "(Mishra & Soni, 2022)",
    "url": "https://data.mendeley.com/public-files/datasets/f45bkkt8pr/files/"
    "edb361de-918d-469f-9106-e84823830665/file_downloaded",
    "file": "mendeley/Dataset_5971.zip",
    "licence": "CC BY 4.0",
    "cite": "https://doi.org/10.17632/f45bkkt8pr.1",
}


@dataclass(frozen=True)
class Message:
    text: str
    kind: str  # ham | spam | smishing
    source: str

    @property
    def scam(self) -> bool:
        return self.kind != "ham"


def fetch(entry: dict[str, str]) -> Path:
    path = DATA / entry["file"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {entry['name']}")
        with httpx.Client(follow_redirects=True, timeout=120) as http:
            path.write_bytes(http.get(entry["url"]).raise_for_status().content)
    return path


def load_uci(path: Path) -> list[Message]:
    with zipfile.ZipFile(path) as archive, archive.open("SMSSpamCollection") as raw:
        lines = io.TextIOWrapper(raw, encoding="utf-8", errors="replace").read().splitlines()
    out = []
    for line in lines:
        label, _, text = line.partition("\t")
        if label in ("ham", "spam") and text.strip():
            out.append(Message(text.strip(), label, "uci"))
    return out


def load_mendeley(path: Path) -> list[Message]:
    with zipfile.ZipFile(path) as archive:
        name = next(n for n in archive.namelist() if n.lower().endswith(".csv"))
        with archive.open(name) as raw:
            rows = list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace")))
    out = []
    for row in rows:
        kind = (row.get("LABEL") or "").strip().lower()
        text = (row.get("TEXT") or "").strip()
        if kind in ("ham", "spam", "smishing") and text:
            out.append(Message(text, kind, "mendeley"))
    return out


def deduplicate(messages: list[Message]) -> tuple[list[Message], int, int]:
    """One message per normalised text; a text seen with both labels is dropped."""
    by_key: dict[str, Message] = {}
    labels: dict[str, set[bool]] = {}
    for m in messages:
        key = normalise(m.text)
        labels.setdefault(key, set()).add(m.scam)
        by_key.setdefault(key, m)
    conflicts = {k for k, v in labels.items() if len(v) > 1}
    kept = [m for k, m in by_key.items() if k not in conflicts]
    return kept, len(messages) - len(by_key), len(conflicts)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def thresholds(p: np.ndarray, y: np.ndarray) -> tuple[float, float, list[str]]:
    """warn: the smallest threshold with precision >= PRECISION_FLOOR (and at least 20 positives
    predicted); quiet: the largest threshold with recall >= RECALL_FLOOR."""
    notes = []
    grid = np.round(np.arange(0.01, 1.0, 0.01), 2)
    warn = None
    for t in grid:
        predicted = p >= t
        if predicted.sum() < 20:
            continue
        precision = (predicted & (y == 1)).sum() / predicted.sum()
        if precision >= PRECISION_FLOOR:
            warn = float(t)
            break
    if warn is None:
        warn = 0.95
        notes.append(f"no threshold reached precision {PRECISION_FLOOR}; warn fixed at 0.95")
    quiet = 0.0
    for t in grid:
        recall = ((p >= t) & (y == 1)).sum() / max((y == 1).sum(), 1)
        if recall >= RECALL_FLOOR:
            quiet = float(t)
    quiet = round(max(0.0, quiet - 0.01), 2)  # strictly below the last threshold that kept it
    if quiet >= warn:
        notes.append(f"quiet {quiet} met warn {warn}; quiet moved to {round(warn / 2, 2)}")
        quiet = round(warn / 2, 2)
    return warn, quiet, notes


def prf(predicted: np.ndarray, y: np.ndarray) -> dict[str, float]:
    tp = int((predicted & (y == 1)).sum())
    fp = int((predicted & (y == 0)).sum())
    fn = int((~predicted & (y == 1)).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "tp": tp, "fp": fp, "fn": fn}


def rules_flag(text: str, families: list[str]) -> bool:
    """The rules alone, as the phone would judge with no model: a family, a strong link finding
    or a big ask."""
    if families or any(link.suspicious for link in find_links(text)):
        return True
    return any(sign in BIG_ASKS for sign in pressure_signs(text))


def rules_warn(text: str) -> bool:
    """What the rules alone would speak about: a big ask or a brand look-alike link."""
    if any(sign in BIG_ASKS for sign in pressure_signs(text)):
        return True
    return any(
        f.startswith(("brand_lookalike", "punycode"))
        for link in find_links(text)
        for f in link.findings
    )


def _classifier(penalty: str, c: float) -> LogisticRegression:
    return LogisticRegression(
        penalty=penalty, C=c, class_weight="balanced", solver="liblinear", max_iter=5000,
        random_state=SEED,
    )  # fmt: skip


def pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--max-features", type=int, default=12000)
    parser.add_argument("--vectors", type=int, default=40, help="test messages kept as fixtures")
    parser.add_argument("--no-synthetic", action="store_true", help="train on the corpora alone")
    args = parser.parse_args(argv)

    uci_path, mendeley_path = fetch(UCI), fetch(MENDELEY)
    raw = load_uci(uci_path) + load_mendeley(mendeley_path)
    messages, duplicates, conflicts = deduplicate(raw)
    (spec,) = load_signals(REPO / "skills" / "scam-shield" / "signals.yaml")
    print(f"{len(raw)} messages, {duplicates} duplicates and {conflicts} conflicts removed, "
          f"{len(messages)} kept ({sum(m.scam for m in messages)} scam)")  # fmt: skip

    corpus_n = len(messages)
    synth_train: list[Synthetic] = []
    synth_test: list[Synthetic] = []
    if not args.no_synthetic:
        made = synthetic(SEED)
        known = {normalise(m.text) for m in messages}
        made = [x for x in made if normalise(x.text) not in known]
        synth_train, synth_test = split(made, SEED)
        messages += [Message(x.text, x.kind, "synthetic") for x in synth_train]
        print(
            f"synthetic: {len(synth_train)} for training, {len(synth_test)} held out "
            f"({sum(x.kind == 'ham' for x in made)} genuine, "
            f"{sum(x.kind != 'ham' for x in made)} scam)"
        )

    families = [fired_families(spec, m.text) for m in messages]
    docs = [tokens(m.text, families=f) for m, f in zip(messages, families, strict=True)]
    y = np.array([int(m.scam) for m in messages])
    # The real corpora are split 70/15/15 and their test fold stays pure; synthetic messages only
    # ever join the training side.
    index = np.arange(corpus_n)
    train_i, rest_i = train_test_split(
        index, test_size=0.30, stratify=y[:corpus_n], random_state=SEED
    )
    val_i, test_i = train_test_split(rest_i, test_size=0.50, stratify=y[rest_i], random_state=SEED)
    train_i = np.concatenate([train_i, np.arange(corpus_n, len(messages))])

    vectoriser = TfidfVectorizer(
        analyzer=lambda doc: doc, sublinear_tf=True, min_df=2, max_features=args.max_features,
        norm="l2", smooth_idf=True, lowercase=False, token_pattern=None, dtype=np.float64,
    )  # fmt: skip
    x_train = vectoriser.fit_transform([docs[i] for i in train_i])
    x_val = vectoriser.transform([docs[i] for i in val_i])
    x_test = vectoriser.transform([docs[i] for i in test_i])

    best: tuple[float, LogisticRegression, str, float] | None = None
    for penalty in ("l2", "l1"):
        for c in (0.5, 1.0, 2.0, 4.0, 8.0):
            clf = _classifier(penalty, c).fit(x_train, y[train_i])
            ap = float(average_precision_score(y[val_i], clf.decision_function(x_val)))
            if best is None or ap > best[0]:
                best = (ap, clf, penalty, c)
    if best is None:
        raise RuntimeError("no classifier fitted")
    val_ap, _, penalty, c = best
    print(f"chosen: {penalty} C={c} (validation AP {val_ap:.4f})")

    # Calibration and thresholds need more than the validation fold: take out-of-fold margins
    # over train+val (five folds), fit Platt scaling to them, choose the zones on them, then fit
    # the final classifier on all of train+val. The test fold stays untouched.
    fit_i = np.concatenate([train_i, val_i])
    x_fit = vectoriser.transform([docs[i] for i in fit_i])
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    d_oof = cross_val_predict(
        _classifier(penalty, c), x_fit, y[fit_i], cv=folds, method="decision_function"
    )
    platt = LogisticRegression(C=1e4, max_iter=5000).fit(np.asarray(d_oof).reshape(-1, 1), y[fit_i])
    a, b = -float(platt.coef_[0][0]), -float(platt.intercept_[0])
    clf = _classifier(penalty, c).fit(x_fit, y[fit_i])

    def probability(x: Any) -> np.ndarray:
        d = clf.decision_function(x)
        return 1.0 / (1.0 + np.exp(a * d + b))

    p_oof = 1.0 / (1.0 + np.exp(a * np.asarray(d_oof) + b))
    warn, quiet, notes = thresholds(p_oof, y[fit_i])
    notes.append(f"thresholds chosen on {len(fit_i)} out-of-fold messages (train+val, 5 folds)")
    p_test = probability(x_test)
    y_test = y[test_i]
    kinds_test = np.array([messages[i].kind for i in test_i])
    smishing = kinds_test == "smishing"

    model_only = prf(p_test >= 0.5, y_test)
    at_warn = prf(p_test >= warn, y_test)
    rules_only = prf(np.array([rules_flag(messages[i].text, families[i]) for i in test_i]), y_test)
    rules_speak = prf(np.array([rules_warn(messages[i].text) for i in test_i]), y_test)
    ensemble_warn = np.array(
        [(p_test[k] >= warn) or rules_warn(messages[i].text) for k, i in enumerate(test_i)]
    )
    ensemble = prf(ensemble_warn, y_test)
    flagged = np.array(
        [
            (p_test[k] > quiet) or rules_flag(messages[i].text, families[i])
            for k, i in enumerate(test_i)
        ]
    )
    coverage = prf(flagged, y_test)
    zone_of = np.where(p_test >= warn, "warn", np.where(p_test <= quiet, "quiet", "sandbox"))
    shares = {
        z: {"all": pct((zone_of == z).mean()), "scam": pct((zone_of[y_test == 1] == z).mean()),
            "ham": pct((zone_of[y_test == 0] == z).mean())}
        for z in ("warn", "sandbox", "quiet")
    }  # fmt: skip
    bins = np.linspace(0, 1, 11)
    reliability = []
    for lo, hi in pairwise(bins):
        mask = (p_test >= lo) & (p_test < hi if hi < 1 else p_test <= hi)
        if mask.sum():
            reliability.append(
                (lo, hi, int(mask.sum()), float(p_test[mask].mean()), float(y_test[mask].mean()))
            )
    metrics = {
        "n_train": len(train_i), "n_val": len(val_i), "n_test": len(test_i),
        "n_fit": len(fit_i),
        "auc": round(float(roc_auc_score(y_test, p_test)), 4),
        "average_precision": round(float(average_precision_score(y_test, p_test)), 4),
        "brier": round(float(brier_score_loss(y_test, p_test)), 4),
        "precision_at_warn": round(at_warn["precision"], 4),
        "recall_at_warn": round(at_warn["recall"], 4),
        "recall_flagged": round(coverage["recall"], 4),
        "ham_flagged": round(float(flagged[y_test == 0].mean()), 4),
        "f1_model_only": round(model_only["f1"], 4),
        "f1_rules_only": round(rules_only["f1"], 4),
        "f1_ensemble_warn": round(ensemble["f1"], 4),
        "smishing_recall_at_warn": (
            round(float((p_test[smishing] >= warn).mean()), 4) if smishing.any() else 0.0
        ),
        "smishing_recall_flagged": (
            round(float(flagged[smishing].mean()), 4) if smishing.any() else 0.0
        ),
    }  # fmt: skip

    synth: dict[str, Any] = {}
    if synth_test:
        s_fam = [fired_families(spec, x.text) for x in synth_test]
        x_s = vectoriser.transform(
            [tokens(x.text, families=f) for x, f in zip(synth_test, s_fam, strict=True)]
        )
        p_s = probability(x_s)
        y_s = np.array([int(x.kind != "ham") for x in synth_test])
        spoken = np.array([
            ((p_s[k] >= warn) and (bool(s_fam[k]) or any(ln.suspicious for ln in find_links(x.text))))
            or rules_warn(x.text)
            for k, x in enumerate(synth_test)
        ])  # fmt: skip
        looked = np.array([
            (p_s[k] > quiet) or rules_flag(x.text, s_fam[k]) for k, x in enumerate(synth_test)
        ])  # fmt: skip
        synth = {
            "n": len(synth_test), "genuine": int((y_s == 0).sum()), "scam": int((y_s == 1).sum()),
            "model_warn_on_genuine": pct(float((p_s[y_s == 0] >= warn).mean())),
            "spoken_on_genuine": pct(float(spoken[y_s == 0].mean())),
            "spoken_on_scam": pct(float(spoken[y_s == 1].mean())),
            "flagged_on_scam": pct(float(looked[y_s == 1].mean())),
        }  # fmt: skip
        metrics["synthetic_model_warn_on_genuine"] = round(float((p_s[y_s == 0] >= warn).mean()), 4)
        metrics["synthetic_spoken_on_genuine"] = round(float(spoken[y_s == 0].mean()), 4)
        metrics["synthetic_spoken_on_scam"] = round(float(spoken[y_s == 1].mean()), 4)

    vocabulary = {t: int(i) for t, i in vectoriser.vocabulary_.items()}
    order = sorted(vocabulary, key=vocabulary.__getitem__)
    today = datetime.now(UTC)
    model_json: dict[str, Any] = {
        "version": today.strftime("%Y.%m.%d"),
        "trained_at": today.isoformat(timespec="seconds"),
        "normaliser": NORMALISER,
        "datasets": [
            {"name": UCI["name"], "sha256": sha256(uci_path), "licence": UCI["licence"],
             "messages": sum(m.source == "uci" for m in raw)},
            {"name": MENDELEY["name"], "sha256": sha256(mendeley_path), "licence": MENDELEY["licence"],
             "messages": sum(m.source == "mendeley" for m in raw)},
            {"name": "Synthetic transactional and smishing templates (scripts/scam_synth.py)",
             "sha256": sha256(REPO / "scripts" / "scam_synth.py"),
             "licence": "Apache-2.0 (ours; every message made up)",
             "messages": len(synth_train) + len(synth_test)},
        ],
        "vocabulary": {t: i for i, t in enumerate(order)},
        "idf": [round(float(v), 6) for v in vectoriser.idf_[[vocabulary[t] for t in order]]],
        "coef": [round(float(v), 6) for v in clf.coef_[0][[vocabulary[t] for t in order]]],
        "intercept": round(float(clf.intercept_[0]), 6),
        "platt": {"a": round(a, 6), "b": round(b, 6)},
        "zones": {"warn": warn, "quiet": quiet, "link": LINK_THRESHOLD},
        "metrics": metrics,
    }  # fmt: skip
    MODEL.write_text(json.dumps(model_json, separators=(",", ":"), ensure_ascii=False) + "\n")

    # The export must give the same answer as scikit-learn did.
    exported = ScamModel.load(MODEL)
    worst = 0.0
    for k, i in enumerate(test_i):
        ours = exported.score(messages[i].text, families=families[i]).probability
        worst = max(worst, abs(ours - float(p_test[k])))
    if worst > 1e-4:
        print(f"export check FAILED: probabilities differ by up to {worst:.2e}")
        return 1
    print(f"export check: max difference {worst:.2e}; {len(order)} features; "
          f"{MODEL.stat().st_size // 1024} KB")  # fmt: skip

    rng = np.random.default_rng(SEED)
    scam_i = [i for i in test_i if messages[i].scam]
    ham_i = [i for i in test_i if not messages[i].scam]
    picked = list(rng.choice(scam_i, args.vectors // 2, replace=False)) + list(
        rng.choice(ham_i, args.vectors // 2, replace=False)
    )
    vectors = {
        "note": "Messages from the two CC BY 4.0 corpora named in skills/scam-shield/model.json, with "
        "the probability tempo_core.scam_model gives each; apps/android-signal must agree within "
        "0.001. Regenerated by scripts/scam_train.py.",
        "model_version": model_json["version"],
        "cases": [
            {"text": messages[i].text, "kind": messages[i].kind, "families": families[i],
             "probability": round(exported.score(messages[i].text, families=families[i]).probability, 4),
             "zone": exported.score(messages[i].text, families=families[i]).zone}
            for i in picked
        ],
    }  # fmt: skip
    VECTORS.write_text(json.dumps(vectors, indent=1, ensure_ascii=False) + "\n")

    REPORT.write_text(report(
        model_json, messages[:corpus_n], raw, duplicates, conflicts, penalty, c, val_ap, notes,
        shares, reliability, model_only, rules_only, rules_speak, at_warn, ensemble, coverage,
        synth,
    ))  # fmt: skip
    print(
        f"wrote {MODEL.relative_to(REPO)}, {VECTORS.relative_to(REPO)}, {REPORT.relative_to(REPO)}"
    )
    print(json.dumps(metrics, indent=1))
    return 0


def report(
    model: dict[str, Any], messages: list[Message], raw: list[Message], duplicates: int,
    conflicts: int, penalty: str, c: float, val_ap: float, notes: list[str],
    shares: dict[str, dict[str, str]], reliability: list[tuple[float, float, int, float, float]],
    model_only: dict[str, float], rules_only: dict[str, float], rules_speak: dict[str, float],
    at_warn: dict[str, float], ensemble: dict[str, float], coverage: dict[str, float],
    synth: dict[str, Any],
) -> str:  # fmt: skip
    m = model["metrics"]
    z = model["zones"]
    rows = "\n".join(
        f"| {r['name']} | {r['messages']} | {r['licence']} | `{r['sha256'][:12]}…` |"
        for r in model["datasets"]
    )
    rel = "\n".join(
        f"| {lo:.1f}–{hi:.1f} | {n} | {mean:.3f} | {obs:.3f} |"
        for lo, hi, n, mean, obs in reliability
    )
    sh = "\n".join(
        f"| {zone} | {v['all']} | {v['scam']} | {v['ham']} |" for zone, v in shares.items()
    )

    def line(name: str, r: dict[str, float]) -> str:
        return f"| {name} | {pct(r['precision'])} | {pct(r['recall'])} | {r['f1']:.3f} | {int(r['fp'])} | {int(r['fn'])} |"

    extra = "\n".join(f"- {n}" for n in notes) or "- none"
    return f"""# Scam Shield backtest

*Written by `scripts/scam_train.py` on {model["trained_at"]}; model version {model["version"]}.
Re-run with `make scam-train`. The plan and the contracts are in [scam-shield.md](scam-shield.md).*

## Data

| Corpus | Messages | Licence | File |
|---|---|---|---|
{rows}

{len(raw)} messages in all; {duplicates} exact duplicates (after normalisation) and {conflicts}
label conflicts removed; **{len(messages)} kept**, of which {sum(m.scam for m in messages)} are
scams (spam or smishing). Split 70/15/15 by message, seed {SEED}: {m["n_train"]} train,
{m["n_val"]} validation, {m["n_test"]} test. Every number below is on the **test** fold, which
nothing was fitted on. The classifier is TF-IDF (sub-linear tf, {len(model["vocabulary"])}
features) with logistic regression ({penalty}, C={c}), chosen on validation average precision
({val_ap:.4f}), then refitted on train+validation; Platt scaling and the zone thresholds were set
on five-fold out-of-fold margins over those {m["n_fit"]} messages.

Attribution: Almeida, T. A. and Hidalgo, J. M. G., *SMS Spam Collection*, UCI Machine Learning
Repository (2012), CC BY 4.0. Mishra, S. and Soni, D., *SMS Phishing Dataset for Machine Learning
and Pattern Recognition*, Mendeley Data, V1 (2022), doi:10.17632/f45bkkt8pr.1, CC BY 4.0.

## Ranking and calibration

| Metric | Value |
|---|---|
| ROC-AUC | {m["auc"]} |
| Average precision | {m["average_precision"]} |
| Brier score (lower is better) | {m["brier"]} |

Reliability (predicted against observed, ten bins):

| Predicted P(scam) | Messages | Mean predicted | Observed scam share |
|---|---|---|---|
{rel}

## Zones

`warn` is P ≥ {z["warn"]} (the smallest threshold with precision ≥ {PRECISION_FLOOR} out of
fold); `quiet` is P ≤ {z["quiet"]} (the largest with recall ≥ {RECALL_FLOOR} out of fold) and no
link finding; everything between is the `sandbox`. A message with fewer than three words never
reaches `warn` on the model alone. Notes from choosing them:

{extra}

| Zone | All test messages | Scams | Genuine |
|---|---|---|---|
{sh}

## What each layer earns

Precision and recall for the scam class on the test fold. "Rules alone" is what a phone with no
model would send to the Gateway (a keyword family, a strong link finding or a big ask); "rules
speak" is what the rules alone would say out loud (a big ask or a brand look-alike link);
"ensemble warn" is what Scam Shield speaks about (the model's warn zone or the rules' speak set);
"flagged" is everything Scam Shield looks at (the warn or sandbox zone, or any rule).

| Layer | Precision | Recall | F1 | False alarms | Missed |
|---|---|---|---|---|---|
{line("Rules alone (flag)", rules_only)}
{line("Rules alone (speak)", rules_speak)}
{line("Model alone, P ≥ 0.5", model_only)}
{line(f"Model warn zone, P ≥ {z['warn']}", at_warn)}
{line("Ensemble warn (spoken)", ensemble)}
{line("Flagged (looked at)", coverage)}

Smishing (the Mishra & Soni label for texts with a phishing hook) specifically: {pct(m["smishing_recall_at_warn"])}
of smishing texts are in the warn zone and {pct(m["smishing_recall_flagged"])} are flagged.
{pct(m["ham_flagged"])} of genuine messages are flagged for a look (most settle silently in the
sandbox; only the warn zone speaks).

## The texts the corpora never saw

The corpora hold almost no genuine transactional texts (a bank's one-time code, an NHS
appointment, a council-tax reminder, a parcel from the real carrier), so a model trained on them
alone reads "formal" as "scam". `scripts/scam_synth.py` writes those kinds from templates, both
genuine and 2026-style scams, declared as synthetic and never mixed into the corpora's test fold.
On the synthetic messages held out of training ({synth.get("n", 0)}: {synth.get("genuine", 0)}
genuine, {synth.get("scam", 0)} scam):

| What | Share |
|---|---|
| Model alone puts a genuine transactional text in the warn zone | {synth.get("model_warn_on_genuine", "n/a")} |
| Scam Shield **speaks** on a genuine transactional text | {synth.get("spoken_on_genuine", "n/a")} |
| Scam Shield speaks on a synthetic scam | {synth.get("spoken_on_scam", "n/a")} |
| Scam Shield flags a synthetic scam for a look | {synth.get("flagged_on_scam", "n/a")} |

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
"""


if __name__ == "__main__":
    sys.exit(main())
