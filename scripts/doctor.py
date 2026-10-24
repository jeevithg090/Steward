"""`make doctor`: check every key and service with one cheap live call.

Exits 1 while any required service is failing or not configured.
"""

import asyncio
import sys

from tempo_adapters.doctor import exit_code, render, run_checks
from tempo_adapters.settings import Settings


def main() -> int:
    results = asyncio.run(run_checks(Settings()))
    print(render(results))
    return exit_code(results)


if __name__ == "__main__":
    sys.exit(main())
