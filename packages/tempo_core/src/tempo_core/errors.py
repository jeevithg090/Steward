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
