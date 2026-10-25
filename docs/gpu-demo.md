# The live demo on a real GPU

Tempo's model-backed parts run on **our own open-weight model on a RunPod Serverless GPU**:
- the Consensus Court's three jurors;
- the chat's small talk;
- reading photos of letters and the engineer's card.

The Gateway runs on this machine, a Cloudflare quick tunnel gives it a public address, and the
web app on Vercel talks to it. `plan.md` §13 has the reasoning; this page is the runbook.

## What is real, and what is still recorded

| Real | Still recorded (the badge says so) |
|---|---|
| The jurors' votes, small talk and photo reading (Qwen2.5-VL-7B-Instruct on the GPU) | Rail data: live needs Realtime Trains or HSP keys |
| Tempo's voice (ElevenLabs), when its key is set | The company: Tempo never files a real claim with GWR or Broadbandly in a demo |
| Scam Shield's text model and rules (on the Gateway) | Companies House, the FCA register and the link sandbox: their keys, and `SCAM_SANDBOX=live` |
| Every amount: always from the rule packs, never from a model | |

`/health` lists exactly what is simulated and names the model; the web app's badge shows both.

## 1. The GPU: a RunPod Serverless endpoint (about five minutes)

Either flow gives the same endpoint. Both use RunPod's own vLLM worker; nothing of Tempo's runs
on RunPod except the model.

**A. From this GitHub repo** (the flow in RunPod's "Deploy a new endpoint" screen):

1. **Repository and branch:** `jeevithg090/Tempo`, branch `main`.
2. **Dockerfile path:** `deploy/runpod/Dockerfile`. RunPod's notice that it "could not find
   runpod.serverless.start()" is expected; the handler is in the base image.
3. **Endpoint type:** Queue, the default.

**B. Without a build:** Serverless → New endpoint → Docker image `runpod/worker-v1-vllm:v2.30.1`.
Paste the variables from [`deploy/runpod/worker.gpu-demo.env`](../deploy/runpod/worker.gpu-demo.env).

Then configure the endpoint:

| Setting | Value | Why |
|---|---|---|
| GPU | 24 GB (L4, A5000 or RTX 4090); 48 GB if the worker reports it ran out of memory | a 7B vision-language model in bf16 is about 17 GB |
| Container disk | 50 GB | the worker image and the model download both land here |
| Active (always-on) workers | **1 during the demo**, 0 otherwise | no cold start on stage; nothing billed when it is 0 |
| Max workers | 2 | a hard cap on spend |
| Idle timeout | 60 s | the GPU is released quickly after the demo |
| FlashBoot | on | faster restarts |
| Network volume (optional) | any size ≥ 20 GB in the same region | keeps the model between cold starts |

Copy the **Endpoint ID** from the endpoint's page. Create an **API key** under Settings →
API Keys; a key restricted to this endpoint is enough.

## 2. The keys, on this machine only

```bash
printf 'RUNPOD_API_KEY=%s\nRUNPOD_ENDPOINT_ID=%s\n' '<api key>' '<endpoint id>' >> ../.tempo-live/.env
chmod 600 ../.tempo-live/.env
```

`../.tempo-live/.env` sits next to the repo, never inside it. Add `ELEVENLABS_API_KEY` there too
for the real voice. The script refuses a `.env` that sets `DATABASE_URL`.

## 3. Run it

```bash
make live-demo
```

The script runs five steps (`scripts/live_demo.sh`):
1. It opens a Cloudflare quick tunnel to port 8100.
2. It deploys the web app to the Vercel project `tempo-live`, built against the tunnel's address and a fresh demo token.
3. It starts the Gateway with `TEMPO_DEPLOY=cloud-gpu TEMPO_MODELS=live TEMPO_MODE=replay`, allowing only the Vercel site as its web origin and binding Face ID to that site.
4. It wakes the GPU, waiting up to 15 minutes until the model answers, and straight away seeds the demo's people, so no seeded court sits with a cold GPU.
5. It asks the model once more through the Gateway's own model client, which proves the key and the endpoint.

It prints one URL to open. `--restart-gateway` (and so `make live-switch` and the end of
`make live-test`) wakes the GPU first too.

A cold worker loads the model before its first answer: 2.5 to 6 minutes on 25 Oct 2026, even
when RunPod listed the workers as idle and ready. An always-on worker answers in seconds. If the
GPU goes cold mid-demo, the jurors time out after 20 s: the Court then says a juror was absent and
asks you, which is the designed behaviour.

`make live-demo-stop` stops the Gateway and the tunnel. Then set the endpoint's active workers
back to 0 in RunPod.

## 4. Test every feature, for real

```bash
make live-test
```

The suite runs against the running live demo and then restarts the Gateway clean (missions and
paired devices cleared, the demo's people seeded again):

- **`tests/live/test_live_demo.py`: 26 checks through the public tunnel.**
  - The GPU worker and its served model name, and vLLM holding the model to a JSON schema.
  - `/health` naming the model, CORS that admits only the live site, the bearer, and live events over the tunnel's WebSocket.
  - Small talk from the model, three jurors on the GPU with the amount from the rules, Yes until the money arrives, one claim per journey, and a profile refusing before anything starts.
  - The model reading the engineer's card and two letters: the sender, who owes whom, and the exact amount.
  - Scam Shield (also in Hindi), memory and forgetting, the entitlement screen, the real voice, the Patience Profiles, profiles and share codes, the Privacy Proof, and STOP.
- **`tests/e2e/live.spec.ts`: 18 checks on the live Vercel site in Chrome.**
  - The badge, and every page with no console errors.
  - The chat's claim with the three GPU jurors shown, through to the money arriving.
  - A sample photo read by the model, Scam Shield, and the voice setting.
  - Face ID bound to the live site, removed again afterwards.

Each run uses fresh test users. A real model words things differently each time, so the checks
are on facts and structure, and the amounts must match exactly.

## Things to know

- **The demo token is public.** It is in the Vercel bundle, so anyone with the site can drive this
  demo Gateway, and spend GPU time and voice quota, while it runs. It is fresh each run; stop the
  demo afterwards.
- **The tunnel address changes every run**, so the script redeploys the Vercel site each time. The
  showcase at https://tempo-showcase.vercel.app stays as the no-backend fallback.
- **Face ID on the live site** is bound to the Vercel host (`MESH_RP_ID`). The local demo at
  localhost keeps its own Gateway on port 8000.
- **Costs:** you pay RunPod per second a worker runs; with active workers at 0, nothing is billed
  while idle. Check the console's price for the GPU you pick.
- **Keep one worker active during the demo.** With 0 active workers and RunPod's default idle
  timeout of about 5 s, every request after a pause queued for about 2 minutes while a fresh worker
  loaded the model (measured 25 Oct 2026: 107 s queued, 1.4 s to run). With one active worker,
  jobs queue 1 s and run in 0.5 s.
- **Without a GPU: `make live-switch MODE=apis`** puts the same site on hosted models
  (`cloud-apis`). It needs `GEMINI_API_KEY`. With `NVIDIA_API_KEY` too (build.nvidia.com), NVIDIA's
  Nemotron 3.5 Bolt takes the second juror seat on its own rate limit; on Gemini's free tier the
  two Flash-Lite families are the only fast, separate rate limits. `OPENROUTER_API_KEY` with
  `OPENROUTER_MODELS` is an opt-in seat. The Privacy Proof names each provider that really sits on
  the Court. `make live-switch MODE=gpu` switches back.
- **Web Push** on the live site uses a VAPID key pair the script makes once in `../.tempo-live/.env`.
