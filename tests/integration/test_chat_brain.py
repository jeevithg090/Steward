"""The chat's brain (plan.md §16): a language model holds the conversation and acts only through
Tempo's tools, on a Gateway built by `build()` in replay mode with a stand-in for NVIDIA's API.

What must hold:
- The brain's own words come back, and the rules still note the facts said.
- A claim the brain calls runs through the rules, so the amount is the rule pack's.
- A fact the person never said is refused and asked for, never used.
- Words that break the rules (an amount, a claim of having acted) or a failing model leave the
  turn to the rules.
- STOP and the person's yes or no never reach the model.
- /health names NVIDIA as an outside AI company.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

TOKEN = "brain-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NVIDIA = "https://integrate.api.nvidia.com/v1/chat/completions"
JOURNEY = "The 08:12 from Oxford to Paddington on 23 October 2026 was late, ticket £28.40"
CLAIM = {
    "origin_station": "Oxford", "destination_station": "Paddington", "travel_date": "2026-10-23",
    "departure_time": "08:12", "fare_gbp": "28.40",
}  # fmt: skip


def says(text: str) -> httpx.Response:
    return httpx.Response(
        200, json={"choices": [{"message": {"role": "assistant", "content": text}}]}
    )


def calls(tool: str, args: dict[str, str]) -> httpx.Response:
    call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": tool, "arguments": json.dumps(args)},
    }
    return httpx.Response(
        200,
        json={"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [call]}}]},
    )


Script = Callable[[dict[str, Any]], httpx.Response]


@pytest.fixture
def brain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[TestClient, respx.Route, list[Script]]]:
    """A Gateway whose brain answers from `script[0]` (set by each test)."""
    monkeypatch.chdir(tmp_path)
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
        payment_check_after_s=0, chat_brain="nvidia", nvidia_api_key="nv-test",
        addons=False,  # tests/integration/test_addons.py starts a real add-on; none here
    )  # fmt: skip
    script: list[Script] = [lambda body: says("Hello, I'm Tempo.")]
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(NVIDIA).mock(
            side_effect=lambda request: script[0](json.loads(request.content))
        )
        mock.route(host="testserver").pass_through()
        with TestClient(build(settings)) as client:
            client.respx = mock  # type: ignore[attr-defined]  # for a look-up's stand-in
            yield client, route, script


def chat(client: TestClient, text: str, **extra: Any) -> dict[str, Any]:
    r = client.post(
        "/chat",
        headers=AUTH,
        json={"user_id": "u_margaret", "display_name": "Margaret", "text": text, **extra},
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def test_the_brain_answers_in_its_own_words_and_the_rules_keep_the_facts(brain: Any) -> None:
    client, route, script = brain
    script[0] = lambda body: says("I'm sorry about the train. Where were you going?")
    reply = chat(client, "my train from Oxford was late")

    assert reply["reply"] == reply["say"] == "I'm sorry about the train. Where were you going?"
    assert reply["intent"] == "rail_delay" and reply["mission"] is None
    assert reply["slots"]["origin_crs"] == "OXF"  # noted by the rules, for a later turn
    sent = json.loads(route.calls.last.request.content)
    assert sent["model"] == "nvidia/nemotron-3-ultra-550b-a55b"
    assert sent["chat_template_kwargs"] == {"enable_thinking": False}  # fast tool calls
    assert {t["function"]["name"] for t in sent["tools"]} >= {
        "claim_late_train",
        "check_message_for_scam",
    }


def test_the_brain_sees_the_conversation_so_far(brain: Any) -> None:
    client, route, script = brain
    script[0] = lambda body: says(
        "Trains from Oxford usually arrive at London Paddington. Was it that one?"
    )
    history = [
        {"role": "user", "text": "my train to London is late"},
        {"role": "tempo", "text": "Which station did you leave from?"},
        {"role": "user", "text": "Oxford"},
        {"role": "tempo", "text": "Where were you going?"},
    ]
    reply = chat(client, "London", history=history)

    assert reply["intent"] == "rail_delay"  # a short answer keeps the conversation's topic
    sent = json.loads(route.calls.last.request.content)["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user", "assistant", "user"]
    assert sent[-1]["content"] == "London" and sent[3]["content"] == "Oxford"


def test_a_claim_said_in_full_starts_at_once_without_the_model(brain: Any) -> None:
    client, route, _ = brain
    reply = chat(client, JOURNEY)
    assert reply["ask"]["amount_gbp"] == "14.20" and route.call_count == 0


def test_a_claim_the_brain_gathers_over_turns_runs_through_the_rules(brain: Any) -> None:
    client, route, script = brain
    script[0] = lambda body: calls("claim_late_train", CLAIM)
    history = [
        {"role": "user", "text": "my train from Oxford to London was late on 23 October 2026"},
        {
            "role": "tempo",
            "text": "Trains from Oxford usually reach London Paddington. What time did it leave?",
        },
    ]
    reply = chat(client, "the 08:12, and the ticket was 28.40", history=history)

    assert route.call_count == 1  # not every fact was in this turn: the brain gathered them
    assert reply["mission"]["state"] == "awaiting_consent"
    assert reply["ask"]["amount_gbp"] == "14.20"  # the rule pack's, never the model's
    assert reply["reply"] == reply["ask"]["summary"]  # code's words for the offer


def test_a_fact_the_person_never_said_is_refused_and_asked_for(brain: Any) -> None:
    client, _, script = brain
    seen: list[dict[str, Any]] = []

    def model(body: dict[str, Any]) -> httpx.Response:
        seen.append(body)
        if "tools" in body:  # the first call: it invents a time and a fare
            return calls(
                "claim_late_train", CLAIM | {"departure_time": "09:00", "fare_gbp": "30.00"}
            )
        return says("What time did the train leave, and what did the ticket cost?")

    script[0] = model
    reply = chat(client, "my train from Oxford to Paddington on 23 October 2026 was late")

    assert reply["mission"] is None and reply["ask"] is None
    assert reply["reply"] == "What time did the train leave, and what did the ticket cost?"
    told = seen[-1]["messages"][-1]
    assert told["role"] == "tool" and "never said" in told["content"]
    assert "tools" not in seen[-1]  # the follow-up only talks


def test_a_tradesperson_tempo_cannot_claim_for_is_said_kindly(brain: Any) -> None:
    client, _, script = brain

    def model(body: dict[str, Any]) -> httpx.Response:
        if "tools" in body:
            return calls(
                "claim_missed_engineer_visit", {"provider": "plumber", "visit_date": "2026-10-24"}
            )
        return says(
            "I'm sorry they didn't come. I can only claim for broadband or phone engineers."
        )

    script[0] = model
    reply = chat(client, "My plumber didnt come yesterday")
    assert reply["reply"].startswith("I'm sorry they didn't come.") and reply["mission"] is None


@pytest.mark.parametrize(
    "said",
    ["I've claimed £14.20 for you.", "Your claim has been submitted.", "You'll get 50% back."],
)
def test_words_that_break_the_rules_leave_the_turn_to_the_rules(brain: Any, said: str) -> None:
    client, route, script = brain
    script[0] = lambda body: says(said)
    reply = chat(client, "my train from Oxford was late")
    assert route.call_count == 1 and said not in reply["reply"]
    assert reply["needs"][0]["field"] == "destination_crs"  # the rules' one question


def test_a_failing_brain_leaves_the_turn_to_the_rules(brain: Any) -> None:
    client, route, script = brain
    script[0] = lambda body: httpx.Response(503, json={"error": "busy"})
    reply = chat(client, "my train from Oxford was late")
    assert route.call_count == 1
    assert reply["needs"][0]["field"] == "destination_crs"


def test_stop_and_the_persons_yes_never_reach_the_model(brain: Any) -> None:
    client, route, script = brain
    script[0] = lambda body: calls("claim_late_train", CLAIM)
    asked = chat(client, JOURNEY)
    assert asked["ask"] is not None
    before = route.call_count

    yes = chat(client, "yes")
    assert yes["intent"] == "approve" and yes["mission"]["state"] != "awaiting_consent"
    stop = chat(client, "stop")
    assert stop["intent"] == "stop"
    assert route.call_count == before  # code alone answered both


def test_health_names_nvidia_when_it_holds_the_conversation(brain: Any) -> None:
    client, _, _ = brain
    health = client.get("/health").json()
    assert health["chat"]["brain"] == "nvidia:nvidia/nemotron-3-ultra-550b-a55b"
    assert "nvidia" in health["third_parties"]


def test_a_place_alone_is_not_labelled_a_claim_and_notes_no_journey(brain: Any) -> None:
    """Asked on the live site: "find hotels in oxford" was labelled Delay Repay and noted Oxford."""
    client, _, script = brain
    script[0] = lambda body: says("I can't search for hotels, but I can help with a late train.")
    reply = chat(client, "find hotels in oxford")
    assert reply["intent"] == "smalltalk"
    assert reply["slots"].get("origin_crs") is None


def test_the_brain_looks_things_up_and_shows_where_its_answer_came_from(brain: Any) -> None:
    """Asked on the live site: "find hotels in oxford". Tempo is open to anything now (plan.md §17)."""
    client, route, script = brain
    nominatim = client.respx.get("https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=[{
            "name": "The Buttery Hotel", "type": "hotel", "osm_type": "way", "osm_id": 1,
            "display_name": "The Buttery Hotel, 11 Broad Street, Oxford",
            "extratags": {"website": "https://www.thebutteryhotel.co.uk/"},
        }])
    )  # fmt: skip

    def model(body: dict[str, Any]) -> httpx.Response:
        if body["messages"][-1]["role"] == "tool":  # it has read what the look-up found
            assert "The Buttery Hotel" in body["messages"][-1]["content"]
            return says(
                "OpenStreetMap lists:\n- The Buttery Hotel, 11 Broad Street. Rooms from about £120."
            )
        assert {t["function"]["name"] for t in body["tools"]} >= {
            "calculate",
            "find_places",
            "weather",
        }
        return calls("find_places", {"what": "hotel", "where": "Oxford"})

    script[0] = model
    reply = chat(client, "find hotels in oxford")

    assert nominatim.called and route.call_count == 2
    assert reply["intent"] == "smalltalk" and reply["mission"] is None
    assert (
        reply["reply"]
        == "OpenStreetMap lists:\n• The Buttery Hotel, 11 Broad Street. Rooms from about £120."
    )
    assert "\n" not in reply["say"]  # the voice gets one paragraph
    assert reply["sources"] == [
        {"title": "The Buttery Hotel", "url": "https://www.thebutteryhotel.co.uk/"}
    ]
    assert [s["kind"] for s in reply["steps"]] == ["think", "look_up", "think"]
    tools = client.get("/health").json()["chat"]["tools"]
    assert tools["count"] >= 17 and "openstreetmap" in tools["sources"]
