## Bank email checker

Reads a suspicious email that claims to be from your bank, checks the sender address, every link, and the wording against the bank's real website, and gives you a clear verdict before you click anything.

### What it does

- Finds the email you point to (by subject, sender, or recent list).
- Extracts all links and checks each domain against the bank's known domain.
- Looks at email authentication headers (SPF/DKIM/DMARC) when present.
- Flags common phishing signs: urgency, generic greetings, requests for secrets, look-alike domains.
- Returns a short report: sender, link verdicts, phishing signs, and a final verdict.

### What it needs

- The `mail` connector so it can read your messages.
- Internet access for `web_search` and `web_fetch`.

### What it will not do

- Click any link in the suspicious email.
- Log in to any site.
- Reply to, forward, or delete the email.
- Guess your bank's real domain if it cannot find it.
- Call any phone number from the email.
