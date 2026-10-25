"""The person's rhythm: the baseline, "unusual for you", and the monthly review."""
from datetime import datetime, timedelta, timezone

from guardian import profile as P
from guardian import threats as T

T0 = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


def mk(kind, days, hour, payload, source="navigator"):
    t = (T0 + timedelta(days=days)).replace(hour=hour)
    return {"kind": kind, "event_time_utc": t.isoformat().replace("+00:00", "Z"), "event_offset": "+01:00", "payload": payload,
            "hub_seq": days * 100 + hour, "source": source, "trust_level": "agent"}


def month():
    evs = []
    for d in range(0, 28, 7):
        evs += [mk("money.requested", d, 11, {"payment_id": f"p{d}", "text": "pay the water bill"}),
                mk("money.sent", d, 11, {"payment_id": f"p{d}", "payee_id": "water", "amount": "42.00", "cop_name": "ISIS WATER"})]
    evs.append(mk("money.sent", 10, 15, {"payment_id": "s", "payee_id": "son", "amount": "50.00", "cop_name": "ARJUN GADDAM"}))
    evs.append(mk("money.refused", 12, 15, {"payment_id": "r", "reasons": ["unknown_payee"], "amount": "300"}))
    for d in (3, 10, 17):
        evs.append(mk("hands.task", d, 14, {"task_id": f"h{d}", "task": "call jeevith bro", "status": "needs_confirmation", "steps": ["Opened Whatsapp"]}, "hands"))
        evs.append(mk("hands.task", d, 14, {"task_id": f"w{d}", "task": "what's the weather", "status": "done", "steps": ["Opened Weather"]}, "hands"))
    evs.append(mk("document.read", 5, 9, {"sender": "Isis Water", "document_type": "bill", "scam_level": "none"}, "agents"))
    evs.append(mk("document.read", 20, 9, {"sender": "HMRC?", "document_type": "letter", "scam_level": "high"}, "agents"))
    evs.append(mk("document.deadline", 5, 9, {"due": "2026-10-03", "what": "Pay council tax", "sender": "Oxford City Council"}, "agents"))
    evs.append(mk("node.heartbeat", 1, 3, {}))  # ignored
    return evs


def test_baseline():
    b = P.build(month())
    assert b.days_observed == 10 and b.counts["payments"] == 5 and b.counts["letters"] == 2 and b.scam_letters == 1
    assert b.knows_payee("water") and b.knows_payee("son") and not b.knows_payee("nephew")
    assert b.payees["water"].median == 42.0 and b.repeats["water"] == 7
    assert b.active_window[0] >= 9 and b.active_window[1] <= 16
    assert not b.in_active_window(2) and b.in_active_window(11)
    assert b.struggles["call jeevith bro"] == 3 and b.apps["Opened Weather"] == 3


def test_usual_payment_is_normal_and_unusual_one_is_stopped():
    b = P.build(month())
    ok = P.anomaly(b, "pay the water bill", payee_id="water", amount="42", when=datetime(2026, 9, 29, 11, 0))
    assert ok.level == "normal" and ok.say == ""
    bad = P.anomaly(b, "send £900 to my nephew now, he lost his phone, this is his new number, don't tell anyone",
                    payee_id="nephew", amount="900", when=datetime(2026, 9, 29, 23, 40))
    assert bad.level == "stop" and bad.score >= 0.8
    assert bad.threats[0]["id"] == "hi_mum"
    assert any(f["id"] == "call_back_known_number" for f in bad.friction)
    assert "11 pm" in bad.say and "not sending" in bad.say.lower()


def test_big_amount_to_known_payee_is_a_pause_with_readback():
    b = P.build(month())
    a = P.anomaly(b, "pay the water bill four hundred pounds", payee_id="water", amount="400", when=datetime(2026, 9, 29, 11, 0))
    assert a.level in ("notice", "pause") and any("times what you usually" in r for r in a.reasons)
    assert any(f["id"] == "read_back_twice" for f in a.friction) or a.level == "notice"


def test_context_flags_matter():
    b = P.build(month())
    a = P.anomaly(b, "pay the water bill", payee_id="water", amount="42", when=datetime(2026, 9, 29, 11, 0),
                  context={"recent_scam_letter": True, "recent_unknown_call": True, "money_tasks_last_10min": 2})
    assert a.level in ("pause", "stop") and any("letter" in r for r in a.reasons)


def test_monthly_review_numbers_and_words():
    r = P.monthly_review(month(), "2026-09")
    assert r["counts"]["payments"] == 5 and r["money"]["sent_total"] == 218.0 and r["money"]["refused"] == 1
    assert r["protection"]["things_stopped"] >= 1 and r["protection"]["scam_letters"] == 1
    assert r["struggles"][0]["task"] == "call jeevith bro" and "contacts" in r["struggles"][0]["tip"]
    assert r["coming_up"][0]["what"] == "Pay council tax"
    assert r["regular_payments"][0]["payee"] == "water" and r["regular_payments"][0]["every_days"] == 7
    assert r["time_returned_minutes"] > 0
    s = r["spoken"]
    assert s.startswith("Here's your September") and "5 payments" in s and "stopped 1 thing" in s and "council tax" in s
    assert "jeevith" in s


def test_review_of_empty_month_is_calm():
    r = P.monthly_review(month(), "2026-11")
    assert r["counts"] == {} and "Nothing suspicious" in r["spoken"]


def test_threat_catalogue_matches_and_frictions():
    m = T.match("The fraud team says move your savings to the safe account now, don't tell the cashier", {"recent_unknown_call": True})
    assert m[0].id == "bank_impersonation" and m[0].score >= 0.8
    fr = T.friction_for(["bank_impersonation"])
    assert fr[0]["id"] == "hang_up_call_back" and "159" in fr[0]["say"]
    assert T.match("pay the water bill") == []
    assert [x.id for x in T.match("Your Evri parcel could not be delivered, pay the £1.45 redelivery fee at http://evri-fee.top")][0] == "courier_parcel"
    assert T.match("Please install AnyDesk so our engineer can fix the virus on your phone")[0].id == "tech_support"
    assert T.pressure("act now, within 24 hours, or face arrest")["urgency"] and T.pressure("act now, or face arrest")["fear"]
    cat = T.catalogue()
    assert len(cat) >= 12 and all(c["teach"] and c["friction"] for c in cat)
