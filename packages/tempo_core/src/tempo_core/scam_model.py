"""The Scam Shield text model: pure inference over a model shipped as data (docs/scam-shield.md §4).

The model file (skills/scam-shield/model.json) is written by scripts/scam_train.py from two open
SMS corpora (UCI SMS Spam Collection; Mishra & Soni's SMS Phishing Dataset; both CC BY 4.0). This
module turns a message into the same tokens the trainer used, looks each one up, and returns a
calibrated probability that the message is a scam and the zone that probability falls in. There is
no library behind it: a dictionary lookup, a dot product and a sigmoid, so the Kotlin node
(apps/android-signal) runs the same file and gives the same answer, and so does a test.

The model ranks; it never decides on its own. `tempo_core.scam.assess` combines its score with
the rules, the links and the registers, and code chooses the verdict.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from itertools import pairwise
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tempo_core.links import clean_text, find_links, findings_of, fold

Zone = Literal["warn", "sandbox", "quiet"]
NORMALISER = "v2"  # bump when `normalise` or `tokens` change: an old model file must then fail
MIN_WORDS = 3  # fewer word tokens than this and the model may hold, but never speak

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_MONEY = re.compile(
    r"(?:£|\$|€|₹|\brs\.?|\binr|\bgbp|\busd)\s?\d[\d,]*(?:\.\d+)?"
    r"|\d[\d,]*(?:\.\d+)?\s?(?:gbp|usd|inr|rs|pounds?|quid|rupees?|lakhs?|crores?|p\b)"
)
_PHONE = re.compile(r"(?<!\d)\+?\d[\d\s().-]{8,}\d(?!\d)")
_OTP = re.compile(r"(?<!\d)\d{6}(?!\d)")  # the shape of a one-time code
_CODE = re.compile(r"(?<!\d)\d{4,8}(?!\d)")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
_TOKEN = re.compile(r"<[a-z_]+>|[a-z]+(?:'[a-z]+)?|\d+")
_URL_TOKENS: Mapping[str, str] = {
    "shortener": "<shortlink>",
    "ip_address": "<ipurl>",
    "apk_download": "<apk>",
    "brand_lookalike": "<brandlook>",
    "punycode": "<brandlook>",
}


def normalise(text: str) -> str:
    """One canonical form of a message: folded letters, and every link, email, sum of money,
    phone number, six-digit code (`<otp>`), other code and number replaced by a placeholder.
    Links come first so their digits never become codes."""
    clean = clean_text(text)
    for link in sorted(find_links(text), key=lambda found: len(found.url), reverse=True):
        placeholders = ["<url>"] + [
            _URL_TOKENS[f.partition(":")[0]]
            for f in link.findings
            if f.partition(":")[0] in _URL_TOKENS
        ]
        clean = clean.replace(link.url, " " + " ".join(dict.fromkeys(placeholders)) + " ")
    folded = _EMAIL.sub(" <email> ", fold(clean))
    folded = _MONEY.sub(" <money> ", folded)
    folded = _PHONE.sub(" <phone> ", folded)
    folded = _OTP.sub(" <otp> ", folded)
    folded = _CODE.sub(" <code> ", folded)
    folded = _NUMBER.sub(" <num> ", folded)
    return " ".join(folded.split())


def tokens(
    text: str, *, families: Iterable[str] = (), findings: Iterable[str] | None = None
) -> list[str]:
    """Word unigrams and bigrams of the normalised text, plus a token per keyword family that
    fired (`fam:scam_urgency`) and per link finding (`link:shortener`). The trainer and the phone
    build exactly this list."""
    words = _TOKEN.findall(normalise(text))
    out = list(words) + [f"{a} {b}" for a, b in pairwise(words)]
    out += [f"fam:{family}" for family in families]
    found = findings_of(find_links(text)) if findings is None else list(findings)
    out += [f"link:{f.partition(':')[0]}" for f in dict.fromkeys(found)]
    return out


class Platt(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    a: float
    b: float


class Zones(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    warn: float = Field(gt=0, lt=1)  # p at or above this: speak now
    quiet: float = Field(ge=0, lt=1)  # p at or below this (and no link findings): say nothing
    link: float = Field(ge=0, lt=1)  # a link plus p above this: at least the sandbox

    def of(self, probability: float) -> Zone:
        if probability >= self.warn:
            return "warn"
        if probability <= self.quiet:
            return "quiet"
        return "sandbox"


class Dataset(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    sha256: str
    licence: str
    messages: int


class Score(BaseModel):
    model_config = ConfigDict(frozen=True)

    probability: float  # calibrated P(scam), 0..1
    decision: float  # the raw margin before calibration
    zone: Zone
    top_words: tuple[str, ...]  # the words that pushed the score up most, for the "why"


class ScamModel(BaseModel):
    """A linear text model with its vocabulary, weights, calibration and zone thresholds."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: str
    trained_at: str
    normaliser: str
    datasets: tuple[Dataset, ...]
    vocabulary: dict[str, int]
    idf: tuple[float, ...]
    coef: tuple[float, ...]
    intercept: float
    platt: Platt
    zones: Zones
    metrics: dict[str, float]

    @classmethod
    def load(cls, path: Path) -> ScamModel:
        model = cls.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if model.normaliser != NORMALISER:
            raise ValueError(
                f"{path} was trained with normaliser {model.normaliser!r}; this code is "
                f"{NORMALISER!r}. Run `make scam-train`."
            )
        if not (len(model.idf) == len(model.coef) == len(model.vocabulary)):
            raise ValueError(f"{path}: vocabulary, idf and coef must have the same length")
        return model

    def score(self, text: str, *, families: Iterable[str] = ()) -> Score:
        """P(scam) for one message, and the zone it falls in. The same tokens as training:
        sub-linear tf (1 + ln count), idf, L2 norm, dot product, Platt sigmoid."""
        all_tokens = tokens(text, families=families)
        word_count = sum(
            1 for t in all_tokens if " " not in t and not t.startswith(("fam:", "link:"))
        )
        counts = Counter(all_tokens)
        weights: dict[int, float] = {}
        for token, count in counts.items():
            index = self.vocabulary.get(token)
            if index is not None:
                weights[index] = (1.0 + math.log(count)) * self.idf[index]
        norm = math.sqrt(sum(w * w for w in weights.values())) or 1.0
        decision = self.intercept + sum(w / norm * self.coef[i] for i, w in weights.items())
        probability = 1.0 / (1.0 + math.exp(self.platt.a * decision + self.platt.b))
        contributions = sorted(
            ((w / norm * self.coef[i], i) for i, w in weights.items()), reverse=True
        )
        by_index = {i: t for t, i in self.vocabulary.items()}
        top = tuple(
            by_index[i]
            for c, i in contributions
            if c > 0
            and " " not in by_index[i]
            and not by_index[i].startswith(("<", "fam:", "link:"))
        )[:3]
        zone = self.zones.of(probability)
        if zone == "warn" and word_count < MIN_WORDS:
            zone = "sandbox"  # "645" or "ok" is not a scam text, whatever the weights say
        return Score(probability=round(probability, 6), decision=decision, zone=zone, top_words=top)


def score_text(probability: float) -> str:
    """The two-decimal text form of a score, the only form that may leave a phone."""
    return f"{probability:.2f}"
