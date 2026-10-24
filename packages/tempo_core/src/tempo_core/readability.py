"""Flesch reading ease, so "plain words" is a number we can test (spec §14: no jargon).

60 or more is plain English most adults read easily. Syllables are estimated by vowel groups,
which is close enough to rank sentences; it isn't a dictionary.
"""

from __future__ import annotations

import re

_WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_SENTENCE_END = re.compile(r"[.!?]+(?:\s|$)")
_VOWELS = re.compile(r"[aeiouy]+")


def syllables(word: str) -> int:
    word = word.lower()
    count = len(_VOWELS.findall(word))
    if word.endswith("e") and not word.endswith(("le", "ee")) and count > 1:
        count -= 1
    elif word.endswith("ed") and len(word) > 3 and word[-3] not in "td" and count > 1:
        count -= 1  # "returned" is two syllables; "added" keeps its -ed
    return max(count, 1)


def flesch_reading_ease(text: str) -> float:
    words = _WORD.findall(text)
    if not words:
        return 100.0
    sentences = max(len(_SENTENCE_END.findall(text)), 1)
    syllable_count = sum(syllables(w) for w in words)
    return 206.835 - 1.015 * (len(words) / sentences) - 84.6 * (syllable_count / len(words))
