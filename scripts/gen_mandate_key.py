"""Make MANDATE_SIGNING_KEY: the Gateway's Ed25519 seed for landline mandates (Agent Passport).

    uv run python scripts/gen_mandate_key.py >> .env

Keep it in .env or the platform's secrets only. The public half is published on every mandate it
signs, so a company can check them; rotating it invalidates the mandates it signed.
"""

import base64
import secrets

seed = secrets.token_bytes(32)
print(f"MANDATE_SIGNING_KEY={base64.urlsafe_b64encode(seed).rstrip(b'=').decode()}")
