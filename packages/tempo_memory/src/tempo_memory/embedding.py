"""An offline text embedding: signed feature hashing of words and character trigrams.

No model and no network, so replay mode and tests give the same answers every time. It finds
"prefers phone updates" from "how do I like my updates?"; it is not a semantic model, and live
mode can use a real embedder through Mem0 instead.
"""

from __future__ import annotations

import hashlib
import math
import re

DIMS = 256
WORD = re.compile(r"[a-z0-9£.]+")
STOPWORDS = frozenset({
    "a", "an", "and", "are", "about", "am", "be", "do", "does", "for", "from", "have", "i", "is",
    "it", "me", "my", "of", "on", "or", "so", "that", "the", "this", "to", "was", "what", "when",
    "where", "which", "who", "with", "you", "your", "remember", "know",
})  # fmt: skip


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def features(text: str) -> list[tuple[str, float]]:
    words = [_stem(w) for w in WORD.findall(text.casefold()) if w not in STOPWORDS]
    grams = [
        (f"#{w[i : i + 3]}", 0.4) for w in (f" {w} " for w in words) for i in range(len(w) - 2)
    ]
    return [(w, 1.0) for w in words] + grams


class HashingEmbedder:
    def __init__(self, dims: int = DIMS) -> None:
        self.dims = dims

    def embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dims
        for feature, weight in features(text):
            digest = int.from_bytes(hashlib.blake2b(feature.encode(), digest_size=8).digest())
            vector[digest % self.dims] += weight if digest >> 63 else -weight
        norm = math.sqrt(sum(x * x for x in vector))
        return [x / norm for x in vector] if norm else vector


def cosine(a: list[float], b: list[float]) -> float:
    """Both vectors are unit length (or zero), so the dot product is the cosine."""
    return sum(x * y for x, y in zip(a, b, strict=True))
