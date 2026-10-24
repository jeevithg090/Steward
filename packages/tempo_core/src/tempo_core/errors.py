"""Typed domain errors. User-facing wording for each lives in exactly one place (the Gateway)."""


class TempoError(Exception):
    """Base class for every error Tempo raises on purpose."""


class NotCovered(TempoError):
    """No installed rule pack covers this operator or scheme."""


class IllegalTransition(TempoError):
    """A mission tried to move between states the lifecycle does not allow."""

    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"illegal mission transition {current} → {target}")
        self.current = current
        self.target = target


class ConsentConflict(TempoError):
    """Two active grants disagree about what kind of value a limit is; callers fail closed."""


class ModelAuthExpired(TempoError):
    """The model provider rejected our token even after one refresh; a person must rotate it."""


class ModelOutputInvalid(TempoError):
    """The model's structured output was still invalid after one repair attempt."""


class ServiceNotFound(TempoError):
    """No train matches the journey asked about (wrong station, date or time)."""


class RailDataUnavailable(TempoError):
    """Every rail data source failed; the mission waits and retries or falls back to replay."""


class VisionUnavailable(TempoError):
    """The vision model could not read the document; Tempo asks the person instead."""
