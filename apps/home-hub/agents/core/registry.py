"""The agent registry: every agent in the app is one class here, so the server, the CLI and the phone can list
and run them the same way. Adding an agent = subclass Agent, call register(), done.
"""
from __future__ import annotations

from typing import Any, Callable, Dict

StepFn = Callable[[str], None]


class Agent:
    """One agent. `run` gets validated inputs and an on_step callback for live narration on the phone."""
    name: str = "base"            # URL-safe id, e.g. "document"
    title: str = "Agent"          # shown to people
    description: str = ""         # one sentence, shown to people and to the voice agent
    input_schema: Dict[str, Any] = {}   # JSON schema of `inputs` (documentation + light validation)

    def run(self, inputs: dict, on_step: StepFn, context: dict) -> dict:
        raise NotImplementedError

    def follow_up(self, question: str, context: dict, on_step: StepFn) -> dict:
        """A later question about the same job (optional)."""
        raise NotImplementedError(f"{self.title} doesn't take follow-up questions.")

    def describe(self) -> dict:
        return {"name": self.name, "title": self.title, "description": self.description, "inputs": self.input_schema}


REGISTRY: Dict[str, Agent] = {}


def register(agent: Agent) -> Agent:
    REGISTRY[agent.name] = agent
    return agent


def get(name: str) -> Agent:
    try:
        return REGISTRY[name]
    except KeyError:
        raise KeyError(f"No agent called {name!r}. Known: {', '.join(sorted(REGISTRY)) or 'none'}")


def all_agents() -> list:
    return [a.describe() for a in REGISTRY.values()]
