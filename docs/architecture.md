# Architecture: ports and adapters

Tempo is hexagonal. The domain core is pure Python with no I/O, so every decision about money,
eligibility and consent is deterministic and fast to test.

```mermaid
flowchart LR
  subgraph DOMAIN["Domain core (tempo_core): pure Python, no I/O"]
    M["Models<br/>Fact · Case · ProofTrace · Capsule"]
    RE["Rights Engine<br/>rule packs → Entitlement + ProofTrace"]
    CL["Consent Ledger<br/>deny-wins merge"]
    SM["Mission state machine"]
    AR["Arbiter<br/>EV + explanation"]
    TV["Time value + Ledger maths"]
  end
  subgraph APP["Application layer"]
    WF["MAF Workflows + Executors (tempo_missions)"]
    POL["Harness policies (tempo_harness)"]
  end
  subgraph PORTS["Ports (tempo_ports): typing.Protocol"]
    P["ModelPort · RailDataPort · VisionPort · VoicePort<br/>NotifierPort · RepoPort · MemoryPort"]
  end
  subgraph ADAPTERS["Adapters (tempo_adapters): one file per vendor"]
    A["Cortex · RTT/HSP · Gemini · ElevenLabs/Twilio<br/>Web Push/SMS · Postgres · Mem0/Graphiti"]
  end
  GW["Gateway (FastAPI)"] --> APP
  APP --> DOMAIN
  APP --> PORTS
  ADAPTERS -. implements .-> PORTS
```

## Rules that keep it maintainable

1. **The domain never imports adapters, vendors or network code.**
2. **Every vendor sits behind a port** with a **Live** and a **Replay** implementation. Replay makes
   demos and CI deterministic (`TEMPO_MODE=replay`).
3. **Models only read and plan.** Money, eligibility, consent and permissions are decided by domain
   code: the Rights Engine, the Consent Ledger, the Arbiter and the Harness policies.
4. **Version-sensitive vendor APIs live in one file each**, for example
   `tempo_harness/hooks_adapter.py` for the Agent Hooks payload shape.
5. **Configuration is code:** voice agent configs, rule packs, skill manifests and policies live in
   the repo and are validated in CI.

Decisions are recorded in [adr/](adr/).
