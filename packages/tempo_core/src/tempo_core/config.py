"""Deployment profiles (spec §18, build plan S8.1): the same code in every mode; TEMPO_DEPLOY
picks what sits behind each port, and so which outside companies ever see personal data.

- local: Ollama on this machine; ElevenLabs only with the user's own key; Mem0 + Graphiti;
  an encrypted local disk.
- cloud-standard: Snowflake Cortex, ElevenLabs and Gemini; a per-user encrypted vault.
- cloud-private: our own vLLM on RunPod; no outside AI company sees personal data (voice and
  vision are off until self-hosted speech, P2); a per-user encrypted vault.
- cloud-confidential: vLLM inside a TEE; the vault is decrypted only in the enclave.
- cloud-apis: the live demo's fallback (plan.md §13.5): the three jurors are hosted models from
  Google (Gemini) and OpenRouter, Gemini reads photos, ElevenLabs speaks.
- cloud-gpu: the live demo (plan.md §13): our own vision-language model on a RunPod GPU for the
  jurors, small talk and reading photos; ElevenLabs for the voice. Not private: ElevenLabs is an
  outside AI company, and the Privacy Proof panel says so.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

# Outside AI companies that would process a person's words, if their adapter is in use.
THIRD_PARTY_AI: frozenset[str] = frozenset({"cortex", "elevenlabs", "gemini", "openrouter"})
# A model that is really several outside providers (cloud-apis).
MODEL_PROVIDERS: dict[str, frozenset[str]] = {"apis": frozenset({"gemini", "openrouter"})}


class DeployMode(StrEnum):
    LOCAL = "local"
    STANDARD = "cloud-standard"
    PRIVATE = "cloud-private"
    CONFIDENTIAL = "cloud-confidential"
    GPU = "cloud-gpu"
    APIS = "cloud-apis"


class UnknownDeployMode(ValueError):
    pass


@dataclass(frozen=True)
class Profile:
    mode: DeployMode
    model: str  # "ollama" | "cortex" | "runpod-vllm" | "tee-vllm"
    voice: str  # "elevenlabs" | "off"
    vision: str  # "gemini" | "runpod-vllm" | "off"
    memory: str
    vault: str
    region: str

    @property
    def third_parties(self) -> frozenset[str]:
        """Outside AI processors this mode uses (for the Privacy Proof panel)."""
        used = {self.model, self.voice, self.vision} | MODEL_PROVIDERS.get(self.model, frozenset())
        return THIRD_PARTY_AI & used


PROFILES: dict[DeployMode, Profile] = {
    DeployMode.LOCAL: Profile(DeployMode.LOCAL, "ollama", "elevenlabs", "off", "mem0+graphiti",
                              "local-disk", "this machine"),
    DeployMode.STANDARD: Profile(DeployMode.STANDARD, "cortex", "elevenlabs", "gemini",
                                 "encrypted-vault", "ciphertext-store", "eu"),
    DeployMode.PRIVATE: Profile(DeployMode.PRIVATE, "runpod-vllm", "off", "off",
                                "encrypted-vault", "ciphertext-store", "eu (RunPod Secure Cloud)"),
    DeployMode.CONFIDENTIAL: Profile(DeployMode.CONFIDENTIAL, "tee-vllm", "off", "off",
                                     "enclave-vault", "ciphertext-store", "confidential GPU"),
    DeployMode.GPU: Profile(DeployMode.GPU, "runpod-vllm", "elevenlabs", "runpod-vllm",
                            "encrypted-vault", "ciphertext-store", "this machine + RunPod GPU"),
    DeployMode.APIS: Profile(DeployMode.APIS, "apis", "elevenlabs", "gemini", "encrypted-vault",
                             "ciphertext-store", "this machine + Google and OpenRouter"),
}  # fmt: skip


def profile(mode: str) -> Profile:
    """Fails fast on a typo: a deployment never falls back to a less private mode."""
    try:
        return PROFILES[DeployMode(mode)]
    except ValueError:
        known = ", ".join(m.value for m in DeployMode)
        raise UnknownDeployMode(f"TEMPO_DEPLOY={mode!r} is not one of: {known}") from None
