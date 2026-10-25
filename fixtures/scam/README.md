Synthetic recordings for Scam Shield's replay mode (docs/scam-shield.md). Check every shape
against the live service before relying on field names.

- **Registers** (`ch_search_*.json`, `fca_search_*.json`, `fca_address_*.json`,
  `fca_warning_list.json`): Companies House company search, FCA Register firm search and firm
  address, and a cached FCA Warning List. "Barclays Wealth Desk" is a made-up clone of a real
  firm's name; the phone numbers are Ofcom's reserved drama ranges.
- **Feeds** (`feeds/*.txt`): slices in the shape of the OpenPhish community feed and URLhaus's
  plain-text list, one URL or host per line with a `# fetched_at:` header. Every host is made up.
  `make refresh-feeds` writes real ones to `.data/scam/feeds` (set `SCAM_FEEDS_DIR` to use them).
- **Sandbox** (`sandbox/<host>.json`): what one isolated look behind a link found, in the shape
  `tempo_adapters.scam.sandbox.LiveSandbox` reports: redirects, card and password forms, a brand's
  look on a domain that is not its own, the domain's age, an app file, or "unreachable".
