# Security policy

Steward acts for people: it reads their mail, drives a browser and runs commands. A security bug
here can cost someone money or privacy, so we take reports seriously and answer them quickly.

## Reporting a vulnerability

**Please do not open a public issue for a vulnerability.**

Report it privately through GitHub's **Report a vulnerability** button on the repository's
**Security** tab (private vulnerability reporting). If you cannot use that, open an issue that
says only that you have a security report and asks for a private channel, with no details.

Please include:

- what an attacker can do, and what they need first (a page the agent visits, an email in the
  inbox, access to the machine, a connected app);
- the steps to reproduce, ideally with the scripted model and the demo inbox;
- the version or commit you tested.

Never include real keys, passwords or mail. Made-up values are fine.

## What happens next

- We acknowledge a report within **3 working days**.
- We confirm or rule it out, and agree a fix timeline with you, within **10 working days**.
- We fix it, publish an advisory, and credit you if you would like to be credited.
- Please give us **90 days**, or until a fix is released if that is sooner, before you disclose
  publicly.

We will not take legal action against research done in good faith that respects this policy:
test only against your own installation, do not access other people's data, and do not degrade a
service for others.

## What counts

Anything that breaks a promise Steward makes, for example:

- a tool call that runs without going through the gateway, or that runs when the gateway refused it;
- a send, payment, signature, deletion or command that runs without the approval the rules require,
  including after the conversation has read untrusted content;
- an approval that can be used twice, or that acts on a different call from the one approved;
- a secret (a password, a key, a value typed in the secret box) reaching the model, the
  transcript, the record or a log;
- the agent's browser, `web_fetch` or an MCP connection reaching loopback, private addresses or
  cloud metadata when it should not;
- a web page in the person's browser that can act through Steward's local server;
- a file tool reading or writing outside the agent's workspace;
- a change to the record that verification does not detect.

## What does not count

Some things are known limits, described in [docs/security.md](docs/security.md#what-steward-does-not-protect-against):

- commands the person allowed doing what commands can do (the shell is not sandboxed);
- anyone who can reach an exposed port using Steward (it has no sign-in, and listens on loopback
  by default);
- someone with access to the machine's user account reading Steward's data;
- the outbound check missing a secret that is spelled out, split up or encoded.

If you find a way to make one of these worse than documented, that does count.

## Supported versions

Steward is alpha. Fixes go into the latest release and the `main` branch only.
