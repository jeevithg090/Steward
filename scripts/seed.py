"""`make seed`: put the demo's people into a running Gateway (replay mode).

- Amir's 07:58 Oxford -> Paddington (64 min late) is claimed and paid, so the counters show
  real hours and pounds before the demo starts.
- Margaret's 08:12 (38 min late) is left waiting for her OK: the live beat of the demo.

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
    print(f"Amir:     {amir['state']} - {amir['message']}")
    print(f"Margaret: {margaret['state']} - waiting for her OK")
    print(f"Ledger:   {ledger['hours_returned']} h returned, £{ledger['gbp_recovered']} recovered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
