# Connector fixtures: Margaret's mailbox, calendar and bank statement

**Everything here is invented for the demo.** Margaret, her messages, her calendar and her bank
account are made up. Every email address uses a reserved example domain (`.example` or
`example.com`). The only web link is in the scam email: a made-up trick address of the kind the
scam check is meant to catch. Broadbandly is a simulated company. The first lines of each file
say it is demo data.

The three read-only connector servers (`mcp-servers/mail`, `mcp-servers/calendar`,
`mcp-servers/bank`) read these folders by default; set `TEMPO_CONNECTOR_DATA` to point one at a
different folder. The dates sit around Sunday 25 October 2026.

## What each file is for

"Sweep my inbox" should find four things here (plan §14.1), and pass over the rest:

| File | What it is | What the sweep should make of it |
|---|---|---|
| `mail/trainline-eticket-2026-10-21.eml` | Trainline e-ticket: Oxford 08:12 to London Paddington, Fri 23 Oct, Off-Peak Day Return £28.40, GWR, booking TL7Q2M | the rail records say that train was 38 minutes late, so a Delay Repay claim of £14.20 is waiting |
| `mail/broadbandly-appointment-2026-10-12.eml` | Broadbandly engineer booked for Mon 19 Oct, 8am to 1pm, account BB-4417, with an `.ics` invite attached | with the calendar entry, asks "Did they come?" (a missed visit is owed compensation) |
| `mail/hmrc-refund-scam-2026-10-24.eml` | "HMRC: you are due a tax refund" from a look-alike sender, with a 24-hour deadline and a link | Scam Shield calls it a trick |
| `mail/thames-water-2026-10-03.eml` | Thames Water: she overpaid, £23.40 will be refunded to her bank (plain text and HTML) | the bank statement shows the £23.40 arrived on 9 Oct, so nothing needs doing |
| `mail/library-reminder-2026-10-20.eml` | two library books due back on 27 Oct (HTML only) | nothing: everyday mail |
| `mail/grandchild-photos-2026-10-18.eml` | photos from a grandchild, two small JPEG attachments | nothing: everyday mail |
| `calendar/margaret.ics` | GP appointment (14 Oct), Broadbandly engineer visit (19 Oct, 08:00 to 13:00 UK time), the 08:12 train to London (23 Oct), book club (28 Oct, after the clocks go back) | the engineer visit backs up the email; the rest is everyday life |
| `bank/statement.csv` | October 2026: pension, direct debits, shopping, the Trainline fare, and the Thames Water refund (+23.40 on 9 Oct) | proves the water refund came home. There is **no** GWR or Broadbandly compensation credit: those claims are still open |

## Formats

- `mail/`: one RFC 5322 message per `.eml` file; the id is the file name without `.eml`.
- `calendar/`: iCalendar (`.ics`) files; every one in the folder is read.
- `bank/statement.csv`: columns `date,description,amount`; amounts are signed (money in is
  positive); lines starting with `#` are comments.
