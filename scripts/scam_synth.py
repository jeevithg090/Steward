# ruff: noqa: E501, S311  (templates read better on one line; random is for variety, not secrets)
"""Synthetic messages for Scam Shield's training (docs/scam-shield.md §4.1), declared as such.

The two open corpora are personal chit-chat (ham) against 2005 premium-rate spam and 2022
smishing. They hold almost no *genuine transactional* texts: a bank's one-time code, an NHS
appointment, a council-tax reminder, a parcel from the real Evri, a Trainline ticket. A model
trained on them alone learns "formal and transactional means scam" and puts a real council-tax
reminder at 0.98. This module writes the missing kinds from templates with random fills, both
genuine (official domains, no asks) and 2026-style scams (look-alike domains, short links, fees,
codes, loans, "Hi Mum"). Every message here is made up; phone numbers are Ofcom's drama ranges
and Indian ranges are reserved-looking. The trainer keeps the real corpora's test fold pure and
reports the synthetic set separately, so nothing is hidden behind a blended number.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

BANKS = ("HSBC", "Halifax", "Lloyds Bank", "Barclays", "NatWest", "Santander", "Nationwide", "Monzo",
         "Starling", "TSB", "SBI", "HDFC Bank", "ICICI Bank", "Axis Bank")  # fmt: skip
BRANDS_UK = ("Amazon", "Apple", "Google", "Microsoft", "WhatsApp", "PayPal", "Netflix", "eBay")
MERCHANTS = ("Tesco Stores", "Sainsbury's", "Amazon", "Boots", "Greggs", "Shell", "Argos", "Costa",
             "Big Bazaar", "Reliance Fresh", "Swiggy", "Zomato", "IRCTC")  # fmt: skip
PLACES = ("the John Radcliffe Hospital", "Summertown Health Centre", "Cowley Road Dental",
          "the Churchill Hospital", "Manor Surgery", "Apollo Clinic", "Fortis Hospital")  # fmt: skip
PHARMACIES = ("Boots, Cornmarket Street", "Lloyds Pharmacy, Headington", "Day Lewis, Botley")
COUNCILS = ("oxford", "cherwell", "westoxon", "reading", "southwark", "leeds", "birmingham")
UTILITIES = ("Thames Water", "Octopus Energy", "British Gas", "EDF", "Scottish Power", "BESCOM",
             "Tata Power", "BSES")  # fmt: skip
STATIONS = ("Oxford", "London Paddington", "Reading", "Didcot Parkway", "Banbury", "Swindon")
ITEMS = ("Kettle, 1.7L", "Printer paper, 500 sheets", "Wool socks (3 pairs)", "Garden shears",
         "Reading glasses +2.0", "Dog food, 12kg")  # fmt: skip
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
SCHOOLS = ("St Ebbe's Primary", "Cheney School", "Wood Farm Primary", "DPS Bangalore")
SHORTENERS = ("bit.ly", "tinyurl.com", "rb.gy", "cutt.ly", "t.ly", "is.gd", "tiny.cc")
LOOKALIKE_WORDS = ("secure", "verify", "refund", "update", "redelivery", "help", "online",
                   "support", "claim", "portal", "pay", "track", "kyc", "rebate", "fee")  # fmt: skip
LOOKALIKE_TLDS = ("com", "co", "info", "online", "site", "xyz", "top", "net", "uk", "co.uk", "org")
LOOKALIKE_BRANDS = ("hmrc", "dvla", "royalmail", "evri", "dpd", "halifax", "lloyds", "barclays",
                    "natwest", "hsbc", "santander", "nationwide", "paypal", "amazon", "netflix",
                    "apple", "whatsapp", "sbi", "hdfc", "icici", "paytm", "tvlicensing", "nhs")  # fmt: skip


@dataclass(frozen=True)
class Synthetic:
    text: str
    kind: str  # "ham" | "smishing"


def _otp(rng: random.Random) -> str:
    return f"{rng.randrange(100000, 999999)}"


def _amount(rng: random.Random, lo: int = 4, hi: int = 900) -> str:
    return f"{rng.randrange(lo, hi)}.{rng.randrange(0, 99):02d}"


def _date(rng: random.Random) -> str:
    return f"{rng.randrange(1, 28)} {rng.choice(('Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'March', 'April'))}"


def _time(rng: random.Random) -> str:
    return f"{rng.randrange(7, 19):02d}:{rng.choice(('00', '15', '30', '45'))}"


def _uk_phone(rng: random.Random) -> str:
    return f"07700 900{rng.randrange(100, 999)}"


def _ref(rng: random.Random, n: int = 6) -> str:
    return "".join(rng.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(n))


def _short(rng: random.Random) -> str:
    return f"{rng.choice(SHORTENERS)}/{_ref(rng, rng.randrange(4, 8))}"


def _lookalike(rng: random.Random, brand: str | None = None) -> str:
    b = brand or rng.choice(LOOKALIKE_BRANDS)
    sep = rng.choice(("-", "", "-"))
    host = f"{b}{sep}{rng.choice(LOOKALIKE_WORDS)}.{rng.choice(LOOKALIKE_TLDS)}"
    scheme = rng.choice(("", "", "http://", "https://"))
    path = rng.choice(("", "", f"/{_ref(rng, 5)}", "/claim", "/verify", "/pay"))
    return f"{scheme}{host}{path}"


def genuine(rng: random.Random) -> Iterable[str]:
    """Genuine transactional texts, as banks, the NHS, councils and real carriers send them."""
    r = rng
    for _ in range(14):
        bank = r.choice(BANKS)
        yield f"Your {bank} one-time passcode is {_otp(r)}. Never share this code with anyone, including {bank} staff. If you did not request it, call 159."
        yield f"{_otp(r)} is your {bank} security code. It expires in 10 minutes. We will never ask you for it."
        yield f"{bank}: £{_amount(r)} was paid to {r.choice(MERCHANTS)} on {_date(r)}. Not you? Call us on the number on your card."
        yield f"{bank}: your new card is on its way and should arrive within 5 working days. Your PIN follows separately."
        yield f"You have made a payment of £{_amount(r)} to {r.choice(MERCHANTS)}. If this was not you, call 159, the number on your card."
        yield f"Your {bank} statement is ready to view in the app."
        yield f"{bank}: a Direct Debit of £{_amount(r)} to {r.choice(UTILITIES)} will leave your account on {_date(r)}."
    for _ in range(10):
        brand = r.choice(BRANDS_UK)
        yield f"Your {brand} verification code is {_otp(r)}. Do not share this code with anyone."
        yield f"{brand}: {_otp(r)} is your sign-in code. If you did not try to sign in, you can ignore this message."
        yield f"Your {brand} order of '{r.choice(ITEMS)}' has been dispatched. Track it at https://www.amazon.co.uk/orders"
    for _ in range(12):
        yield f"Your appointment at {r.choice(PLACES)} is on {r.choice(WEEKDAYS)} at {_time(r)}. Reply CANCEL if you cannot attend."
        yield f"Reminder: your prescription is ready to collect from {r.choice(PHARMACIES)}."
        yield "NHS: you are invited to book your flu vaccination. Book at www.nhs.uk/book-a-flu-vaccination or ring your GP."
        yield f"Your dentist appointment is tomorrow at {_time(r)}. Please arrive 10 minutes early."
        yield f"Your GP has sent a message. Read it in the NHS App: www.nhs.uk/nhs-app. Appointment {r.choice(WEEKDAYS)} {_time(r)}."
    for _ in range(10):
        c = r.choice(COUNCILS)
        yield f"Reminder: your council tax instalment of £{_amount(r, 90, 260)} is due on {_date(r)}. Pay at www.{c}.gov.uk/counciltax"
        yield f"{c.title()} City Council: your bin collection moves to {r.choice(WEEKDAYS)} this week because of the bank holiday."
        yield f"{c.title()} Council: your parking permit expires on {_date(r)}. Renew at www.{c}.gov.uk/parking"
    for _ in range(10):
        yield f"Royal Mail: your parcel will be delivered today between {_time(r)} and {_time(r)}. Track at royalmail.com/track-your-item"
        yield f"Evri: your parcel from {r.choice(MERCHANTS)} is on its way. Track it at evri.com/track/{_ref(r, 10)}"
        yield f"DPD: your parcel is due today between {_time(r)} and {_time(r)}. Change delivery at dpd.co.uk"
        yield f"Yodel: we delivered your parcel to the front porch at {_time(r)}. yodel.co.uk/track"
    for _ in range(8):
        a, b = r.sample(STATIONS, 2)
        yield f"GWR: Your {_time(r)} from {a} to {b} is delayed by {r.randrange(5, 60)} minutes."
        yield f"Trainline: your e-ticket from {a} to {b} on {_date(r)} is ready in the app."
        yield f"Chiltern Railways: the {_time(r)} to {b} has been cancelled. Your ticket is valid on the next service."
    for _ in range(8):
        u = r.choice(UTILITIES)
        yield f"Your {u} bill of £{_amount(r, 30, 220)} is ready. View it in your online account."
        yield f"{u}: a meter reading is due. Submit it in the app by {_date(r)}."
        yield f"{u}: we are working in your area on {_date(r)}. Your supply may be off between {_time(r)} and {_time(r)}."
    for _ in range(8):
        yield f"Your Uber is arriving in 3 minutes: silver Toyota Prius, {r.choice(('OX17 KLM', 'LD21 PQR', 'KA05 MJ 4321'))}."
        yield f"Your table at {r.choice(('The Rickety Press', 'Pierre Victoire', 'Vaults and Garden', 'Truffles'))} is booked for {_time(r)} on {r.choice(WEEKDAYS)}. Reply C to cancel."
        yield f"{r.choice(SCHOOLS)}: school closes at 1:30pm on Friday for staff training."
        yield f"Photos from Sunday are here: https://photos.google.com/share/{_ref(r, 12)}"
        yield f"Here's the recipe I mentioned: bbc.co.uk/food/recipes/{_ref(r, 8)}"
        yield f"Meet at the station at {_time(r)}? Map: maps.google.com/?q={r.choice(STATIONS).replace(' ', '+')}"
        yield f"Photos from the walk: {_short(r)} (Google Photos album)"
        yield f"Here is the link you asked for: {_short(r)}"
        yield f"Our new menu is up: {_short(r)}. See you {r.choice(WEEKDAYS)}!"
        yield f"Minutes from Tuesday's meeting: {_short(r)}"
    for _ in range(6):
        yield "HMRC: your tax return has been received. You do not need to do anything else."
        yield f"DVLA: your vehicle tax for {r.choice(('OX17 KLM', 'LD21 PQR'))} is due to expire on {_date(r)}. Renew at www.gov.uk/vehicle-tax"
        yield f"TV Licensing: thank you, your payment of £{_amount(r, 10, 20)} has been received."
    for _ in range(10):
        yield f"Rs {_amount(r, 100, 9000)} debited from a/c XX{r.randrange(1000, 9999)} on {_date(r)} to {r.choice(MERCHANTS)}. Avl bal Rs {_amount(r, 500, 90000)}. Not you? Call 1800 1234 {r.randrange(100, 999)}. -SBI"
        yield f"Your OTP for {r.choice(BRANDS_UK)} transaction is {_otp(r)}. Valid for 10 mins. Do not share with anyone. -HDFC Bank"
        yield f"Dear customer, your electricity bill of Rs {_amount(r, 300, 4000)} is due on {_date(r)}. Pay in the official app. -{r.choice(('BESCOM', 'Tata Power', 'BSES'))}"
        yield f"Your Swiggy order #{r.randrange(100000, 999999)} is out for delivery. Track it in the app."
        yield f"IRCTC: your booking is confirmed. PNR {r.randrange(1000000000, 9999999999)}. Train {r.randrange(10000, 19999)} on {_date(r)}."


def scams(rng: random.Random) -> Iterable[str]:
    """2026-style smishing, as the keyword families and the link rules describe it."""
    r = rng
    for _ in range(10):
        yield f"HMRC: You are due a tax refund of {_amount(r, 100, 900)} GBP. Claim within 24 hours at {_lookalike(r, 'hmrc')}"
        yield f"HMRC: a tax rebate of £{_amount(r, 100, 600)} is waiting. Submit your claim today: {_short(r)}"
        yield f"Your parcel could not be delivered. Pay the £{_amount(r, 1, 3)} redelivery fee at {_lookalike(r, r.choice(('royalmail', 'evri', 'dpd')))}"
        yield f"We tried to deliver your parcel today. Unpaid customs fee of £{_amount(r, 1, 4)}: {_lookalike(r, 'evri')}"
        yield f"Royal Mail: a £{_amount(r, 1, 3)} shipping fee is required before we can redeliver. {_short(r)}"
    for _ in range(10):
        bank = r.choice(BANKS)
        yield f"{bank}: we have detected unusual activity. Move your money to a safe account immediately. Call {_uk_phone(r)}."
        yield f"{bank} fraud team: a new payee has been set up. If this was not you, verify your account now: {_lookalike(r)}"
        yield f"Your {bank} card has been blocked. Read me the code we just sent you to unlock it, or call {_uk_phone(r)}."
        yield f"{bank}: did you make this payment of £{_amount(r, 200, 900)}? Confirm now: {_short(r)}"
        yield f"Your account will be suspended within 24 hours. Verify your identity at {_lookalike(r, bank.split()[0].lower())}"
    for _ in range(8):
        yield "Hi Mum, I have a new phone, this is my new number. Can you pay this bill for me today? I'll explain later, cant talk right now."
        yield f"Hello dad its me, dropped my phone in the sink, im on a friends phone. I need you to transfer me £{_amount(r, 300, 950)} urgently."
        yield "Hi Mum, new number! Save this one. Can you send me your pin number for the card, I need it right away x"
    for _ in range(8):
        yield f"Congratulations! Instant loan of Rs {r.randrange(10, 90) * 1000} approved, no documents, no CIBIL. Pay processing fee {r.randrange(199, 999)} to get disbursal. Download the app: http://{_ref(r, 6)}-loan.{r.choice(('top', 'xyz', 'online'))}/app.apk"
        yield f"Pre-approved loan of £{r.randrange(1, 9) * 1000} with no credit check, guaranteed approval. Quick cash today: {_short(r)}"
        yield f"Loan approved! No paperwork, disbursed within minutes. Pay the processing fee first: {_lookalike(r)}"
    for _ in range(8):
        yield f"SBI: Aapka KYC expired hai. Account band ho jayega. Turant update karein: {_lookalike(r, 'sbi')}"
        yield f"Dear customer your electricity will be disconnected tonight. Update your bill details immediately. Call {r.randrange(70000, 99999)} {r.randrange(10000, 99999)}"
        yield f"Your PAN card is not linked. Update your KYC within 24 hours or your account will be blocked: {_short(r)}"
    for _ in range(8):
        brand = r.choice(BRANDS_UK)
        yield f"{brand}: your payment failed. Update your card to keep your account: {_lookalike(r, brand.lower())}"
        yield f"Your {brand} account has been locked for unusual sign-in. Verify your identity: {_lookalike(r, brand.lower())}"
        yield f"{brand}: you have (1) new message. Act now, it expires tonight: {_short(r)}"
    for _ in range(8):
        yield f"Energy rebate of £400 is ready for your household. Claim within 48 hours: {_lookalike(r, 'gov')}"
        yield f"TV Licensing: your licence has expired. Renew within 24 hours to avoid a fine: {_lookalike(r, 'tvlicensing')}"
        yield f"DVLA: your vehicle tax payment failed. Final notice, update now: {_lookalike(r, 'dvla')}"
        yield f"Congratulations, you have been selected for a £{r.randrange(100, 900)} {r.choice(('Tesco', 'Argos', 'M&S'))} voucher. Last chance to claim: {_short(r)}"
        yield f"Your WhatsApp will be deleted today unless you verify. Confirm your number here: {_short(r)}"
    for _ in range(6):
        yield f"Good day, I am {r.choice(('Sarah', 'James', 'Priya', 'Tom'))} from the fraud department. Your account is compromised. For your protection, transfer your funds to the holding account we have set up. Don't tell your branch."
        yield f"Your Microsoft account has been compromised. Call our security team on 0203 456 {r.randrange(1000, 9999)} within the hour."
        yield f"Investment opportunity: {r.randrange(12, 40)}% returns guaranteed with Bitcoin. Limited time, act today: {_short(r)}"


def synthetic(seed: int = 20261025) -> list[Synthetic]:
    """Deterministic, de-duplicated, both kinds."""
    rng = random.Random(seed)
    seen: dict[str, str] = {}
    for text in genuine(rng):
        seen.setdefault(text, "ham")
    for text in scams(rng):
        seen.setdefault(text, "smishing")
    return [Synthetic(t, k) for t, k in seen.items()]


def split(
    items: Sequence[Synthetic], seed: int = 20261025, held_out: float = 0.2
) -> tuple[list[Synthetic], list[Synthetic]]:
    rng = random.Random(seed)
    shuffled = list(items)
    rng.shuffle(shuffled)
    cut = int(len(shuffled) * (1 - held_out))
    return shuffled[:cut], shuffled[cut:]


if __name__ == "__main__":
    made = synthetic()
    print(
        len(made),
        "messages:",
        sum(m.kind == "ham" for m in made),
        "genuine,",
        sum(m.kind != "ham" for m in made),
        "scam",
    )
    for m in made[:6] + made[-6:]:
        print(" ", m.kind, "|", m.text[:110])
