"""`make seed`: put the demo's people into a running Gateway (replay mode).

- Amir's 07:58 Oxford -> Paddington (64 min late) is claimed and paid, so the counters show
  real hours and pounds before the demo starts.
- Margaret's 08:12 (38 min late) is left waiting for her OK: the live beat of the demo.
- Margaret's memories and timeline (TEMPO_DEMO=1): what she told Tempo, the Broadbandly engineer
  slot that moved from 12 to 19 Oct, and yesterday's promise of £73.67 (ref BB-4417), for the
  "remembers when" beat. Her words still go through the Memory Gate.

Uses GATEWAY_URL (default http://127.0.0.1:8000) and TEMPO_API_TOKEN.
"""

from __future__ import annotations

import os
import sys

import httpx

AMIR = {
    "user_id": "u_amir",
    "display_name": "Amir",
    "origin_crs": "OXF",
    "destination_crs": "PAD",
    "travel_date": "2026-10-22",
    "departure": "07:58",
    "fare_gbp": "28.40",
    "time_value_gbp_h": "31",
}
MARGARET = {
    "user_id": "u_margaret",
    "display_name": "Margaret",
    "origin_crs": "OXF",
    "destination_crs": "PAD",
    "travel_date": "2026-10-23",
    "departure": "08:12",
    "fare_gbp": "28.40",
    "time_value_gbp_h": "18",
}

MARGARET_SAID = [
    "I prefer phone updates.",
    "I commute from Oxford to Paddington.",
    "My daughter Sarah helps me with letters.",
]
BST = "+01:00"


def slot(episode_id: str, *, booked: str, day: int) -> dict[str, str]:
    """Broadbandly's engineer visit, booked at `booked` for 08:00-12:00 on `day` October."""
    return {
        "event": "appointment", "id": episode_id, "user_id": "u_margaret",
        "company": "Broadbandly", "what": "engineer visit", "at": f"{booked}{BST}",
        "starts_at": f"2026-10-{day}T08:00:00{BST}", "ends_at": f"2026-10-{day}T12:00:00{BST}",
    }  # fmt: skip


MARGARET_TIMELINE = [
    slot("seed_bb_slot_1", booked="2026-10-10T09:00:00", day=12),
    slot("seed_bb_slot_2", booked="2026-10-15T14:00:00", day=19),  # moved: the old one is kept
    {
        "event": "promise", "id": "seed_bb_promise", "user_id": "u_margaret",
        "company": "Broadbandly", "at": f"2026-10-23T14:02:00{BST}", "amount_gbp": "73.67",
        "due_by": "2026-11-30T00:00:00+00:00", "reference": "BB-4417",
    },
]  # fmt: skip


def main() -> int:
    token = os.environ.get("TEMPO_API_TOKEN")
    if not token:
        print("Set TEMPO_API_TOKEN (the Gateway's bearer token).")
        return 1
    url = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8000")
    with httpx.Client(base_url=url, headers={"Authorization": f"Bearer {token}"}, timeout=30) as gw:
        amir = gw.post("/missions", json=AMIR).raise_for_status().json()
        gw.post(
            f"/approvals/{amir['ask']['request_id']}", json={"approved": True}
        ).raise_for_status()
        gw.post("/scheduler/tick").raise_for_status()  # needs PAYMENT_CHECK_AFTER_S=0 to pay now
        amir = gw.get(f"/missions/{amir['id']}").raise_for_status().json()
        margaret = gw.post("/missions", json=MARGARET).raise_for_status().json()
        ledger = gw.get("/ledger").raise_for_status().json()
        seeded = gw.post(
            "/demo/memory",
            json={"user_id": "u_margaret", "said": MARGARET_SAID, "episodes": MARGARET_TIMELINE},
        )
    print(f"Amir:     {amir['state']} - {amir['message']}")
    print(f"Margaret: {margaret['state']} - waiting for her OK")
    print(f"Ledger:   {ledger['hours_returned']} h returned, £{ledger['gbp_recovered']} recovered")
    if seeded.status_code == 404:
        print("Memory:   not seeded; run the Gateway with TEMPO_DEMO=1 to seed Margaret's memories")
    else:
        body = seeded.raise_for_status().json()
        print(
            f"Memory:   {len(body['memories'])} memories, {body['facts']} dated facts for Margaret"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
