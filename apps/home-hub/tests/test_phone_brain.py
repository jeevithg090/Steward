"""The phone agent's Gemini brain, offline: a fake HTTP layer stands in for Google, a fake iPhone for iCTRL and a
fake Ollama for the local model. Proves the request shape (native generateContent, key only in the header, minimal
thinking, no temperature, thought signatures echoed), batching, the private-app rule and the local fallback."""
import copy
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "phone"))
sys.path.insert(0, str(ROOT / "hands"))

import gemini_brain as gb  # noqa: E402
import phone_agent as pa  # noqa: E402

KEY = "AIzaFAKE-test-key-0123456789abcdef"
URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
APP = {"com.apple.weather": "Weather", "com.thetrainline.trainline": "Trainline", "net.whatsapp.WhatsApp": "WhatsApp"}
SCREENS = {
    "com.apple.weather": ["Oxford", "12°", "Partly Cloudy", "H:14° L:7°", "Rain expected around 4pm."],
    "com.thetrainline.trainline": ["Where to?", "Search stations", "Today", "Get times & tickets", "Send a gift card"],
    "net.whatsapp.WhatsApp": ["Chats", "Mum", "Running late, love you", "Dad", "See you Sunday"],
}


class FakePhone:
    def __init__(self):
        self.app, self.calls, self.typed = "com.apple.weather", [], []

    def __call__(self, method, params=None, timeout=20.0):
        params = params or {}
        self.calls.append((method, params))
        if method == "launch_app":
            self.app = params["bundle_id"]
        if method == "page_source":
            kinds = {"Search stations": "SearchField"}
            rows = [f"  Application, label: '{APP.get(self.app, 'App')}'"]
            rows += [f"    {kinds.get(t, 'StaticText')}, 0x1, label: '{t}'" for t in SCREENS.get(self.app, [])]
            return {"source": "\n".join(rows), "bundle_id": self.app}
        if method == "find_element":
            hit = [t for t in SCREENS.get(self.app, []) if params["element_id"].lower() in t.lower()]
            return {"ref": "r1", "label": hit[0]} if hit else {}
        if method == "type":
            self.typed.append(params["text"])
        if method == "is_locked":
            return {"locked": False}
        if method == "resolve_app":
            return {"apps": []}
        if method == "screen_text":
            return {"items": []}
        return {}

    def screen_reads(self):
        return sum(1 for m, p in self.calls if m == "page_source" and p.get("max_children") == 50)


class FakeGemini:
    """Replaces gemini_brain.http_post: records each request, answers from a script (dicts or exceptions)."""

    def __init__(self, script):
        self.script, self.requests = list(script), []

    def __call__(self, url, body, headers, timeout):
        self.requests.append((url, json.loads(json.dumps(body)), dict(headers), timeout))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return copy.deepcopy(item)


def call(name, args, sig=None, cid=None):
    part = {"functionCall": {"name": name, "args": args}}
    if cid:
        part["functionCall"]["id"] = cid
    if sig:
        part["thoughtSignature"] = sig
    return part


def reply(*parts):
    return {"candidates": [{"content": {"role": "model", "parts": list(parts)}, "finishReason": "STOP"}]}


def http_error(code, body=b"{}"):
    return urllib.error.HTTPError(URL, code, "error", {}, io.BytesIO(body))


def ollama_says(*calls):
    """Ollama messages, one per decision: (name, args) -> a tool call."""
    return [{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": n, "arguments": a}}]} for n, a in calls]


def clear_brain_settings(monkeypatch):
    for name in ("TEMPO_PHONE_BRAIN", "TEMPO_CONDUCTOR_BRAIN", "TEMPO_PHONE_GEMINI_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)  # a developer's shell may export these


@pytest.fixture()
def rig(monkeypatch):
    clear_brain_settings(monkeypatch)
    phone = FakePhone()
    monkeypatch.setattr(pa, "phone", phone)
    monkeypatch.setattr(gb.time, "sleep", lambda s: None)
    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    seen = []

    def install(gemini_script, ollama_script=()):
        fake = FakeGemini(gemini_script)
        monkeypatch.setattr(gb, "http_post", fake)
        queue = list(ollama_script)

        def ollama(messages):
            seen.append(copy.deepcopy(messages))
            if not queue:
                pytest.fail("the local model was asked but shouldn't have been")
            return queue.pop(0)
        monkeypatch.setattr(pa, "ollama", ollama)
        return fake
    return phone, install, seen


def test_the_request_is_native_gemini_and_echoes_thought_signatures(rig):
    phone, install, seen = rig
    first = reply(call("open_app", {"name": "Weather"}, sig="sig-1", cid="c1"))
    fake = install([first, reply(call("finish", {"answer": "It's 12 degrees and partly cloudy in Oxford."}, sig="sig-2"))])
    out = pa._run("What's the weather like?", False, False, None, "cloud")
    assert out["status"] == "done" and "12 degrees" in out["answer"]
    assert out["brain"] == "Gemini (gemini-3.5-flash-lite)" and len(out["decision_ms"]) == 2 and not seen
    url, body, headers, timeout = fake.requests[0]
    assert url == URL and headers == {"x-goog-api-key": KEY} and timeout == 10.0
    assert KEY not in url and KEY not in json.dumps(body)
    assert body["generationConfig"] == {"maxOutputTokens": 1024, "thinkingConfig": {"thinkingLevel": "minimal"}}
    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "ANY"}}
    decls = {d["name"]: d for d in body["tools"][0]["functionDeclarations"]}
    assert set(decls) == {"open_app", "read_screen", "tap", "type_text", "scroll", "go_home", "finish"}
    assert "parameters" not in decls["read_screen"] and decls["tap"]["parameters"]["required"] == ["label"]
    assert "a few steps at a time" in body["systemInstruction"]["parts"][0]["text"]
    assert body["contents"] == [{"role": "user", "parts": [{"text": "TASK: What's the weather like?\nUser confirmed risky steps: no"}]}]
    history = fake.requests[1][1]["contents"]
    assert history[1] == first["candidates"][0]["content"]  # the model's turn, unchanged, signature and all
    assert history[1]["parts"][0]["thoughtSignature"] == "sig-1"
    fr = history[2]["parts"][0]["functionResponse"]
    assert history[2]["role"] == "user" and fr["name"] == "open_app" and fr["id"] == "c1"
    assert "[text] 12°" in fr["response"]["result"]  # the compact digest, not the page source
    assert "Application, label" not in fr["response"]["result"]


def test_up_to_three_actions_in_one_decision_and_only_the_last_reads_the_screen(rig):
    phone, install, seen = rig
    fake = install([reply(call("open_app", {"name": "Trainline"})),
                    reply(call("tap", {"label": "Search stations"}, cid="a"),
                          call("type_text", {"text": "London", "submit": True}, cid="b")),
                    reply(call("finish", {"answer": "I've searched for trains to London."}))])
    out = pa._run("Look up trains to London on Trainline", False, False, None, "cloud")
    assert out["status"] == "done" and phone.typed == ["London"]
    assert phone.screen_reads() == 2  # after open_app and after the last action, not after the tap
    parts = fake.requests[2][1]["contents"][-1]["parts"]
    assert [p["functionResponse"]["id"] for p in parts] == ["a", "b"]
    assert parts[0]["functionResponse"]["response"]["result"] == "Done."
    assert "Search stations" in parts[1]["functionResponse"]["response"]["result"]


def test_more_than_three_actions_are_answered_but_skipped(rig):
    phone, install, seen = rig
    fake = install([reply(*[call("scroll", {"direction": "down"}) for _ in range(4)]),
                    reply(call("finish", {"answer": "Done."}))])
    pa._run("scroll a lot", False, False, None, "cloud")
    assert sum(1 for m, _ in phone.calls if m == "page") == 3
    results = [p["functionResponse"]["response"]["result"] for p in fake.requests[1][1]["contents"][-1]["parts"]]
    assert len(results) == 4 and results[3].startswith("Skipped")


def test_finish_in_the_same_reply_as_an_action_is_not_taken_as_the_answer(rig):
    phone, install, seen = rig
    fake = install([reply(call("open_app", {"name": "Weather"}), call("finish", {"answer": "It's sunny."})),
                    reply(call("finish", {"answer": "It's 12 degrees and partly cloudy."}))])
    out = pa._run("What's the weather?", False, False, None, "cloud")
    assert out["answer"] == "It's 12 degrees and partly cloudy."
    parts = fake.requests[1][1]["contents"][-1]["parts"]
    assert len(parts) == 2 and parts[1]["functionResponse"]["response"]["result"].startswith("Not finished")


def test_a_blocked_action_stops_the_rest_of_the_decision(rig):
    phone, install, seen = rig
    phone.app = "com.thetrainline.trainline"
    install([reply(call("tap", {"label": "Send a gift card"}), call("type_text", {"text": "hi", "submit": True})),
             reply(call("finish", {"answer": "Sending that needs your OK first."}))])
    out = pa._run("send a gift card", False, False, None, "cloud")
    assert out["status"] == "needs_confirmation" and phone.typed == []
    assert not any(m == "tap" for m, _ in phone.calls)


def test_a_gemini_error_hands_the_task_to_the_local_model(rig):
    phone, install, seen = rig
    fake = install([http_error(503), http_error(503)],
                   ollama_says(("open_app", {"name": "Weather"}), ("finish", {"answer": "It's 12 degrees."})))
    out = pa._run("What's the weather like?", False, False, None, "cloud")
    assert out["status"] == "done" and out["answer"] == "It's 12 degrees."
    assert len(fake.requests) == 2  # one retry, then never again in this task
    assert out["brain"] == "local qwen2.5:7b" and "HTTP 503" in out["brain_note"]
    assert seen[0][0] == {"role": "system", "content": pa.SYSTEM} and seen[0][1]["content"].startswith("TASK: What's")


def test_a_mid_task_failure_keeps_the_history_for_the_local_model(rig):
    phone, install, seen = rig
    install([reply(call("open_app", {"name": "Weather"}, sig="s")), urllib.error.URLError("timed out")],
            ollama_says(("finish", {"answer": "It's 12 degrees."})))
    out = pa._run("What's the weather like?", False, False, None, "cloud")
    assert out["answer"] == "It's 12 degrees."
    msgs = seen[0]
    assert msgs[2]["role"] == "assistant" and msgs[2]["tool_calls"][0]["function"] == {"name": "open_app", "arguments": {"name": "Weather"}}
    assert msgs[3]["role"] == "tool" and "12°" in msgs[3]["content"]


def test_a_private_app_on_screen_switches_to_the_local_model(rig):
    phone, install, seen = rig
    fake = install([reply(call("open_app", {"name": "WhatsApp"}))],
                   ollama_says(("finish", {"answer": "Mum says she's running late."})))
    out = pa._run("any new WhatsApp messages?", False, False, None, "device")
    assert out["answer"] == "Mum says she's running late." and "private app" in out["brain_note"]
    assert len(fake.requests) == 1
    assert all("Running late" not in json.dumps(body) for _, body, _, _ in fake.requests)
    assert "Running late" in seen[0][-1]["content"]


def test_which_brain_and_where_the_key_comes_from(tmp_path, monkeypatch):
    clear_brain_settings(monkeypatch)
    assert gb.choose("TEMPO_PHONE_BRAIN") == "ollama" and pa.Brain("x").gemini is None  # no key (conftest)
    env = tmp_path / "agents.env"
    env.write_text(f"GEMINI_API_KEY={KEY}\n")
    monkeypatch.setenv("KAIROS_AGENTS_ENV_FILE", str(env))
    assert gb.choose("TEMPO_PHONE_BRAIN") == "gemini" and gb.key_source() == "agents/.env"
    assert pa.Brain("x").label == "Gemini (gemini-3.5-flash-lite)"
    monkeypatch.setenv("GEMINI_PHONE_MODEL", "gemini-3.8-flash")
    assert pa.Brain("x").label == "Gemini (gemini-3.8-flash)"
    monkeypatch.setenv("TEMPO_PHONE_BRAIN", "ollama")
    assert gb.choose("TEMPO_PHONE_BRAIN") == "ollama" and pa.Brain("x").gemini is None
    assert gb.choose("TEMPO_CONDUCTOR_BRAIN", "TEMPO_PHONE_BRAIN") == "ollama"
    monkeypatch.setenv("TEMPO_CONDUCTOR_BRAIN", "gemini")
    assert gb.choose("TEMPO_CONDUCTOR_BRAIN", "TEMPO_PHONE_BRAIN") == "gemini"


def test_errors_never_carry_the_key_and_a_thinking_refusal_is_retried_without_it(monkeypatch):
    fake = FakeGemini([http_error(403, json.dumps({"error": {"message": f"key {KEY} is not valid"}}).encode())])
    monkeypatch.setattr(gb, "http_post", fake)
    with pytest.raises(gb.GeminiError) as e:
        gb.Gemini(key=KEY).step("sys", [gb.user_text("hi")], [])
    assert KEY not in str(e.value) and "HTTP 403" in str(e.value) and "Gemini(" in repr(gb.Gemini(key=KEY))
    assert KEY not in repr(gb.Gemini(key=KEY))
    fake = FakeGemini([http_error(400, b'{"error": {"message": "thinking_level is not supported"}}'),
                       reply({"text": "hello"})])
    monkeypatch.setattr(gb, "http_post", fake)
    assert gb.Gemini(key=KEY).step("sys", [gb.user_text("hi")], []).text == "hello"
    assert "thinkingConfig" in fake.requests[0][1]["generationConfig"]
    assert "thinkingConfig" not in fake.requests[1][1]["generationConfig"]


def test_a_malformed_call_is_asked_again_once(monkeypatch):
    fake = FakeGemini([{"candidates": [{"finishReason": "MALFORMED_FUNCTION_CALL"}]}, reply(call("go_home", {}))])
    monkeypatch.setattr(gb, "http_post", fake)
    turn = gb.Gemini(key=KEY).step("sys", [gb.user_text("hi")], gb.declarations(pa.TOOLS))
    assert [c.name for c in turn.calls] == ["go_home"] and len(fake.requests) == 2


def test_the_conductor_plans_with_gemini_json_and_falls_back(rig, monkeypatch):
    import conductor
    phone, install, seen = rig
    plan = {"subtasks": [{"device": "laptop", "task": "Check the battery"}, {"device": "phone", "task": "Check the weather"}]}
    fake = install([{"candidates": [{"content": {"role": "model", "parts": [{"text": json.dumps(plan)}]}}]}])
    assert conductor.plan("battery and weather") == plan["subtasks"]
    url, body, headers, _ = fake.requests[0]
    assert url == URL and headers == {"x-goog-api-key": KEY} and "tools" not in body
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["contents"] == [{"role": "user", "parts": [{"text": "battery and weather"}]}]
    install([http_error(429)])
    monkeypatch.setattr(conductor, "ollama_json", lambda s, u: {"subtasks": [{"device": "hub", "task": "Was my train late?"}]})
    assert conductor.plan("was my train late") == [{"device": "hub", "task": "Was my train late?"}]
