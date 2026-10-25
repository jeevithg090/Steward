"""Measure time-to-first-token for an Ollama model via streaming /api/chat."""
import json, sys, time, urllib.request
model = sys.argv[1]
prompt = sys.argv[2] if len(sys.argv) > 2 else "Say hello in five words."
body = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True,
        "options": {"temperature": 0.2, "num_predict": 40}}
req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
t0 = time.perf_counter(); first = None; text = ""; final = {}
with urllib.request.urlopen(req, timeout=300) as r:
    for line in r:
        if not line.strip():
            continue
        d = json.loads(line)
        c = d.get("message", {}).get("content", "")
        if c and first is None:
            first = time.perf_counter() - t0
        text += c
        if d.get("done"):
            final = d
total = time.perf_counter() - t0
ns = lambda k: final.get(k, 0) / 1e9
print(json.dumps({"model": model, "ttft_s": round(first or -1, 2), "total_s": round(total, 2),
                  "load_s": round(ns("load_duration"), 2), "prompt_eval_s": round(ns("prompt_eval_duration"), 2),
                  "gen_tok_per_s": round(final.get("eval_count", 0) / max(ns("eval_duration"), 1e-9), 1),
                  "text": text.strip()[:80]}))
