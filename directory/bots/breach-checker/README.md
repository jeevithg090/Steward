## Breach checker

Checks whether an email address appears in known data breaches by querying public breach databases such as Have I Been Pwned.

**What it does**
- Asks for the email address to check
- Searches multiple public breach-lookup services
- Shows a table of any breaches found with dates and exposed data types
- Reports plainly when no breaches are found in checked sources

**What it needs**
- The email address you want checked (provided at runtime)
- Web access to search and fetch from breach-lookup sites

**What it will not do**
- Store or remember your email address
- Sign up for monitoring or alert services
- Click links in breach notifications
- Guarantee the address has never been breached — only reports what public databases show
