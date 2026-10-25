"""Offline tests for the letter reader: a fake model, no network, no key."""
from __future__ import annotations

import base64
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from agents.core import config
from agents.core.llm import Chain, Provider, ModelError, prepare_image
from agents.core.memory import HubMemory
from agents.core.speech import Speech, pcm_to_wav
from agents.document_interpreter import safety, schema
from agents.document_interpreter.agent import DocumentInterpreterAgent
from agents.server import create_app

WATER = {
    "readable": True, "language_of_document": "en-GB", "document_type": "utility",
    "sender": {"name": "Isis Water", "type": "water company"}, "recipient_name": "Mrs P Okafor",
    "date_of_document": "2026-10-17",
    "summary_plain": "Your water account is in credit: you paid £38.20 too much, so there is nothing to pay this month.",
    "key_points": ["You overpaid by £38.20", "Nothing to pay this month", "Credit comes off the December bill"],
    "money": {"you_owe": 0, "they_owe_you": 38.2, "currency": "GBP", "already_paid": True},
    "dates": [{"date": "2026-10-02", "what": "payment received"}], "deadline": {}, "actions_required": [],
    "urgency": "none", "tone": "good_news", "scam_risk": {"level": "none", "reasons": []},
    "reference_numbers": [{"label": "Account number", "value": "2041 8873 11"}],
    "contact": {"phone": "0800 316 9800", "website": "isiswater.co.uk"},
    "transcript": "Your account is in credit. You do not need to pay anything this month.", "confidence": 0.95,
}
COUNCIL = {
    **WATER, "document_type": "council", "sender": {"name": "Oxford City Council", "type": "council"},
    "summary_plain": "A council tax reminder: £142 is overdue and must be paid by 3 November 2026.",
    "money": {"you_owe": 142.0, "currency": "GBP"}, "deadline": {"date": "2026-11-03", "what": "Pay the overdue instalment"},
    "actions_required": [{"action": "Pay £142.00", "by_when": "2026-11-03", "how": "online, phone or PayPoint"}],
    "urgency": "high", "tone": "bad_news", "transcript": "Please pay £142.00 by 3 November 2026.",
}
SCAM = {
    **WATER, "document_type": "tax", "sender": {"name": "HM Revenue & Customs", "type": "HMRC"},
    "summary_plain": "Claims you are owed a £563.88 tax refund if you verify your bank card within 48 hours.",
    "money": {"they_owe_you": 563.88, "currency": "GBP"}, "scam_risk": {"level": "low", "reasons": []},
    "contact": {"website": "www.hmrc-refund-claims.co.uk", "phone": "07700 900123"},
    "transcript": "verify your bank card details within 48 hours at www.hmrc-refund-claims.co.uk or legal action may be taken. WhatsApp our agent on 07700 900123",
}


class FakeProvider(Provider):
    name = "fake"

    def __init__(self, facts, text="This is a letter from the water company. You paid too much, so you owe nothing today."):
        self.facts, self.text, self.prompts = facts, text, []

    def understand(self, images, prompt, schema_, system=""):
        assert images and images[0][1] == "image/jpeg"
        return json.loads(json.dumps(self.facts))

    def write(self, prompt, system="", max_tokens=700):
        self.prompts.append(prompt)
        return self.text


class FailingProvider(Provider):
    name = "broken"

    def understand(self, *a, **k):
        raise ModelError("down")

    def write(self, *a, **k):
        raise ModelError("down")


def png_b64(w=400, h=300) -> str:
    im = Image.new("RGB", (w, h), "white")
    out = io.BytesIO()
    im.save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


def settings_local() -> config.Settings:
    return config.Settings(provider="local", gemini_api_key="")


def make_agent(facts, text=None):
    prov = FakeProvider(facts, **({"text": text} if text else {}))
    agent = DocumentInterpreterAgent(Chain([prov]), Speech(settings_local()), HubMemory("http://127.0.0.1:1", enabled=False))
    return agent, prov


def test_pipeline_shape_and_steps():
    agent, prov = make_agent(WATER)
    steps, ctx = [], {}
    out = agent.run({"image": png_b64(), "mime": "image/png", "language": "te", "dialect": "Telangana"}, steps.append, ctx)
    assert out["document"]["sender"]["name"] == "Isis Water"
    assert "transcript" not in out["document"]            # stays server-side
    assert ctx["facts"]["transcript"]                       # kept for follow-ups
    assert out["explanation"]["language"] == "te" and out["explanation"]["speech_lang"] == "te-IN"
    assert out["audio"] is None and out["provider"]["voice"] == "device"
    assert out["safety"]["level"] == "none"
    assert out["memory"]["saved"] == 0
    assert steps[0].startswith("Looking at the photo") and steps[-1] == "Done"
    assert any("Isis Water" in s for s in steps)
    assert "Telugu" in prov.prompts[0] and "Telangana" in prov.prompts[0]


def test_follow_up_grounded_and_guarded():
    agent, prov = make_agent(COUNCIL, text="You can ring the council and ask to spread the payments.")
    ctx = {}
    agent.run({"image": png_b64(), "language": "en-GB"}, lambda s: None, ctx)
    a = agent.follow_up("what if I can't pay?", ctx, lambda s: None)
    assert a["answer"].startswith("You can ring")
    assert "Please pay £142.00 by 3 November 2026." in prov.prompts[-1]   # the transcript is in the prompt
    with pytest.raises(ValueError):
        agent.follow_up("", ctx, lambda s: None)
    with pytest.raises(ValueError):
        agent.follow_up("anything", {}, lambda s: None)


def test_fallback_chain_uses_second_provider():
    prov = FakeProvider(WATER)
    chain = Chain([FailingProvider(), prov])
    agent = DocumentInterpreterAgent(chain, Speech(settings_local()), HubMemory("http://127.0.0.1:1", enabled=False))
    out = agent.run({"image": png_b64()}, lambda s: None, {})
    assert out["provider"]["read"] == "fake" and chain.last_provider == "fake"


def test_scam_assessment_is_not_the_models_word_alone():
    risk = safety.assess(schema.normalise(SCAM))
    assert risk["level"] == "high"
    assert any("unusual" in r or "confirm" in r or "non-official" in r for r in risk["reasons"])
    benign = safety.assess(schema.normalise(WATER))
    assert benign["level"] in ("none", "low")


def test_scam_warning_reaches_the_spoken_prompt():
    agent, prov = make_agent(SCAM)
    agent.run({"image": png_b64()}, lambda s: None, {})
    assert "could be a scam" in prov.prompts[0]


def test_memory_events_hold_deadlines_as_dates():
    mem = HubMemory("http://127.0.0.1:1", enabled=False)
    evs = mem.events_for(schema.normalise(COUNCIL), "explained", "en-GB")
    kinds = [e["kind"] for e in evs]
    assert kinds[0] == "document.read" and "document.deadline" in kinds
    dl = [e for e in evs if e["kind"] == "document.deadline"]
    assert all(e["payload"]["due"] == "2026-11-03" for e in dl)
    assert all(e["class"] == "vault" for e in evs)
    assert "Oxford City Council" in evs[0]["payload"]["text"]
    assert mem.remember(schema.normalise(COUNCIL), "x", "en-GB")["saved"] == 0  # off: never raises


def test_normalise_survives_odd_model_output():
    f = schema.normalise({"money": "none", "urgency": "ASAP", "sender": "Isis Water", "scam_risk": "no", "dates": "tomorrow"})
    assert f["urgency"] == "none" and f["sender"]["type"] == "unknown" and f["money"]["you_owe"] is None
    assert f["scam_risk"]["level"] == "none" and f["dates"] == []
    assert schema.normalise({"money": {"you_owe": "£1,234.50"}})["money"]["you_owe"] == 1234.5


def test_prepare_image_downsizes_and_fixes_type():
    im = Image.new("RGB", (3200, 2000), "white")
    out = io.BytesIO()
    im.save(out, format="PNG")
    data, mime = prepare_image(out.getvalue(), "image/png")
    assert mime == "image/jpeg"
    w, h = Image.open(io.BytesIO(data)).size
    assert max(w, h) == 1600
    assert prepare_image(b"not an image", "image/jpeg") == (b"not an image", "image/jpeg")


def test_wav_header():
    wav = pcm_to_wav(b"\x00\x00" * 24000)
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE" and len(wav) == 44 + 48000


def test_spoken_safe_strips_markdown():
    assert safety.spoken_safe("**Hello**\n- one\n- two\n\n# Done") == "Hello one two Done"


def make_client(facts=WATER):
    prov = FakeProvider(facts)
    app = create_app(settings_local(), models=Chain([prov]), speech=Speech(settings_local()),
                     memory=HubMemory("http://127.0.0.1:1", enabled=False))
    return TestClient(app), prov


def test_server_round_trip():
    c, _ = make_client()
    h = c.get("/agents/health").json()
    assert h["ok"] and h["agents"] == ["document"] and h["voice"] == "device" and not h["gemini_key_set"]
    assert c.get("/agents").json()["agents"][0]["name"] == "document"
    r = c.post("/agents/document/interpret", json={"image": png_b64(), "mime": "image/png", "language": "cy", "wait": 10})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "done" and job["result"]["explanation"]["language"] == "cy"
    assert c.get(f"/agents/jobs/{job['id']}").json()["id"] == job["id"]
    assert c.get("/agents/jobs/latest").json()["id"] == job["id"]
    a = c.post(f"/agents/document/{job['id']}/ask", json={"question": "do I owe anything?"})
    assert a.status_code == 200 and a.json()["answer"]
    assert c.post("/agents/document/nope/ask", json={"question": "x"}).status_code == 404
    assert c.get("/agents/jobs/nope").status_code == 404


def test_server_rejects_bad_photos():
    c, _ = make_client()
    assert c.post("/agents/document/interpret", json={"language": "en-GB"}).status_code == 400
    assert c.post("/agents/document/interpret", json={"image": ""}).status_code == 400
    r = c.post("/agents/document/interpret", json={"image": "data:image/png;base64," + png_b64(), "wait": 10})
    assert r.status_code == 200 and r.json()["status"] == "done"   # data: URLs from web pages are fine


def test_server_generic_run_and_unknown_agent():
    c, _ = make_client()
    assert c.post("/agents/nothing/run", json={"inputs": {}}).status_code == 404
    r = c.post("/agents/document/run", json={"inputs": {"image": png_b64()}, "wait": 10})
    assert r.status_code == 200 and r.json()["status"] == "done"


def test_sliced_upload_round_trip():
    c, _ = make_client()
    b64 = png_b64(900, 700)
    n = 5
    size = -(-len(b64) // n)
    parts = [b64[i * size:(i + 1) * size] for i in range(n)]
    uid = "letter_abc123XYZ"
    for i, part in enumerate(parts):
        r = c.post(f"/agents/uploads/{uid}/{i}", json={"data": part, "total": n, "mime": "image/png"})
        assert r.status_code == 200, r.text
        assert r.json()["received"] == i + 1 and r.json()["complete"] == (i == n - 1)
    r = c.post("/agents/document/interpret", json={"upload_id": uid, "language": "pl", "wait": 10})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["result"]["explanation"]["language"] == "pl"
    assert c.post("/agents/document/interpret", json={"upload_id": uid}).status_code == 404   # taken: gone
    assert c.post("/agents/uploads/short/0", json={"data": "x", "total": 1}).status_code == 400
    c.post(f"/agents/uploads/{uid}2/0", json={"data": "abcd", "total": 2})
    assert c.post("/agents/document/interpret", json={"upload_id": uid + "2"}).status_code == 409  # incomplete
