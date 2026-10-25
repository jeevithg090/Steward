# Private mode on RunPod (build plan S8.2)

> **The live GPU demo** (a vision-language model for the jurors, small talk and photos, with
> ElevenLabs for the voice) uses `worker.gpu-demo.env` or `Dockerfile` here and `make live-demo`:
> see [docs/gpu-demo.md](../../docs/gpu-demo.md). Private mode below keeps voice and vision off.

Tempo's model calls go to **our own open-weight model** on a RunPod Serverless vLLM endpoint
instead of an AI company's API. `TEMPO_DEPLOY=cloud-private` makes it the only model client the
Gateway can build (`tempo_adapters/factory.py`); voice and vision, which would send words to
outside companies, are off in this mode.

## Deploy

1. RunPod console → Serverless → New endpoint → **vLLM worker**, **Secure Cloud**, an **EU**
   region, the cheapest GPU that fits the quantised model (24 GB is enough for an 8B AWQ model).
2. Paste the environment from [`worker.env`](worker.env): the served name `tempo-private`, the
   tool-call parser, and request logging and prefix caching **off**.
3. Put `RUNPOD_ENDPOINT_ID` and `RUNPOD_API_KEY` in the Gateway's secrets (the control plane
   only; the key never reaches a device), and set `TEMPO_DEPLOY=cloud-private`.
4. Before showing Private mode: `make evals` runs the 20 tool-calling cases
   (`evals/tool_calling/`) against Cortex and RunPod; the private model must match ≥ 90%.

## Credits plan

| Setting | Value | Why |
|---|---|---|
| Min workers | 0 | scale to zero: no cost while idle |
| Min workers during judging | 1 | no cold start on stage |
| Max workers | 2 | a hard cap on spend |
| Idle timeout | 60 s | release the GPU quickly |
| Budget alert | in the RunPod console, at half the team's credit | no surprises |
