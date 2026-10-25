"""The scam catalogue as code: how each scam looks to the person, the hook it pulls, what Kairos can see on the
phone, the friction that works, and the one-line lesson. Pure data and regexes; no model.

The research behind each entry is in research/Kairos-Guardian-Threats-and-Defence.md (the `ref` field). The entries
are written for people who are not confident with phones: older people, people new to the UK, people who read
little English. Every scam here uses time against them (act now, 48 hours, the courier is waiting). Kairos's answer
is to put time back: cooling-off, call-back, tell someone, read it twice.

    pressure(text)          which levers a message pulls: urgency, authority, secrecy, unusual payment, remote access, codes
    match(text, context)    which scams this looks like, with a score, the terms that matched and the hook
    friction_for(ids)       the friction steps to apply, most protective first
    teach_for(ids)          the lesson to say, in plain words
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

# ---- the levers every scam pulls (Stajano & Wilson's principles, in plain words) ----
LEVERS = {
    "urgency": re.compile(r"\b(urgent(ly)?|immediately|right now|straight ?away|asap|today only|within (24|48|72) hours|"
                          r"last chance|final (notice|warning|demand)|expires? (today|tonight|in \d+ (hours|minutes))|act now|"
                          r"before (midnight|the end of the day)|time is running out|don'?t delay|hurry|"
                          r"(send|pay|transfer|move|do) (it|this|that|the money|£?\d[\d,.]*)? ?(now|tonight|right away)|"
                          r"(now|tonight) (or|before|otherwise))\b", re.I),
    "authority": re.compile(r"\b(hmrc|hm revenue|tax office|inland revenue|dvla|dwp|home office|border force|the police|"
                            r"police officer|detective|fraud (team|department|squad)|court|bailiff|warrant|national crime agency|"
                            r"nca|interpol|ofcom|bt openreach|amazon security|microsoft support|apple support|your bank'?s? (security|fraud)|"
                            r"bank security team|nhs)\b", re.I),
    "secrecy": re.compile(r"\b(don'?t tell (anyone|anybody|your \w+|the \w+|\w+)|"
                          r"keep (this|it) (between us|secret|quiet|confidential)|tell no ?one|say nothing|"
                          r"if (they|the bank|anyone) asks?,? say|don'?t mention|this call is confidential|under investigation)\b", re.I),
    "unusual_payment": re.compile(r"\b(gift ?cards?|itunes|google play|steam (card|voucher)|voucher codes?|bitcoin|crypto|"
                                  r"cryptocurrency|western union|moneygram|wire transfer|safe account|safe keeping account|"
                                  r"holding account|move (your|the) money|transfer (everything|all|your savings)|"
                                  r"cash deposit|pay(ment)? (in|by) cash|courier (will )?collect)\b", re.I),
    "remote_access": re.compile(r"\b(anydesk|teamviewer|quick ?support|screen ?shar(e|ing)|share (my|your) screen|"
                                r"remote (access|desktop|support)|install (this|the) app so i can|let me (control|see) your (phone|screen|computer)|"
                                r"team ?viewer|logmein|rustdesk|supremo|ultraviewer)\b", re.I),
    "codes": re.compile(r"\b(read (me|out) the code|what'?s the code|one[- ]time (code|passcode|password)|otp|"
                        r"the (6|six)[- ]digit (code|number)|passcode|security code|verification code|pin number|your pin|"
                        r"card (number|details)|cvv|memorable (word|answer)|authenticator)\b", re.I),
    "links": re.compile(r"(https?://|www\.|bit\.ly|tinyurl|t\.co/|click (here|the link)|tap (here|the link)|scan (this|the) (qr|code))", re.I),
    "fear": re.compile(r"\b(arrest(ed)?|prison|jail|deport(ed|ation)|fine of|penalty|legal action|prosecut|"
                       r"account (has been|will be|is) (suspended|closed|frozen|compromised|hacked)|"
                       r"someone (has|is) (using|accessed|trying to access) your (account|card)|suspicious (activity|transaction|login))\b", re.I),
    "reward": re.compile(r"\b(you('ve| have) (won|been selected|been chosen)|refund (is )?(due|waiting|owed)|tax (refund|rebate)|"
                         r"compensation (is )?(due|owed)|claim your|prize|free gift|guaranteed returns?|double your|"
                         r"\d{2,3}% (return|profit|interest))\b", re.I),
}

MONEY_APPS = re.compile(r"\b(bank|banking|monzo|revolut|starling|barclays|hsbc|lloyds|natwest|santander|nationwide|halifax|"
                        r"tsb|metro bank|co-?op bank|first direct|paypal|wise|venmo|cash ?app|coinbase|binance|kraken|crypto|"
                        r"wallet|phonepe|paytm|gpay|google pay|apple pay|amex|american express|trading|invest(ing|ment)?|"
                        r"stocks|chase|capital one|klarna|m-?pesa|mobile money|oxbank|oxmoney)\b", re.I)


@dataclass
class Threat:
    id: str
    name: str
    hook: str                       # the human lever, in plain words
    channels: list                  # how it usually arrives
    terms: list                     # regexes over the message / task text
    context: list                   # situation flags that make it likelier (see match())
    friction: list                  # friction ids, most protective first
    teach: str                      # one line to say to the person
    ref: str = ""                   # section in the research doc
    typical_loss: str = ""


THREATS: list[Threat] = [
    Threat("hi_mum", "'Hi Mum / Hi Dad' message from a new number",
           "love for family, plus urgency and a new number", ["whatsapp", "sms"],
           [r"\b(this is (my|his|her) new number|(lost|dropped|broke|smashed) (my|his|her|their) phone|new phone|can'?t (talk|call) right now)\b",
            r"\b(hi|hello|hey) (mum|mom|dad|nan|nana|grandma|grandad|granny|papa|amma|nanna|abba|ammi)\b",
            r"\b(need|borrow|send|transfer) .{0,30}\b(money|cash|£|\$|€|pounds)\b.{0,40}\b(today|now|urgent|asap|before)\b"],
           ["new_payee", "unknown_sender", "urgency"],
           ["call_back_known_number", "cooling_off_new_payee", "tell_someone"],
           "If it's really your child, they'll answer their old number. Call it first. A real emergency can wait one phone call.",
           "§1 Hi Mum", "£1,000–£3,000 per victim"),
    Threat("bank_impersonation", "Someone 'from the bank' or 'the police' says your money is at risk",
           "authority, fear and secrecy; the 'safe account' is the scammer's", ["call", "sms", "whatsapp"],
           [r"\b(safe account|safe keeping|move (your|the) money|transfer (your|the) (money|savings|balance)|new account (we|i)'?ve (set up|opened))\b",
            r"\b(fraud (team|department)|security team|your account (has been|is) (compromised|hacked|at risk))\b",
            r"\b(we('ve| have) (spotted|noticed|detected) (suspicious|unusual|fraudulent))\b"],
           ["authority", "secrecy", "urgency", "new_payee", "recent_unknown_call"],
           ["hang_up_call_back", "pause_money", "tell_someone", "cooling_off_new_payee"],
           "Your bank and the police never ask you to move money to another account. Hang up. Call the number on your card.",
           "§1 Impersonation / APP", "£3,000–£20,000"),
    Threat("courier_parcel", "A parcel or delivery text with a small fee and a link",
           "small amount, mild urgency, a familiar brand", ["sms", "email"],
           [r"\b(parcel|package|delivery|shipment|evri|hermes|royal mail|dpd|yodel|dhl|ups|fedex|post office)\b.{0,60}\b(fee|redeliver|re-?delivery|unpaid|customs|held|pay £?\d)\b",
            r"\b(missed (your )?delivery|couldn'?t deliver|redelivery fee)\b"],
           ["links", "small_amount"],
           ["verify_official", "never_pay_by_link"],
           "Real couriers don't text for a fee. Check the tracking in the shop's own app or website, not the link.",
           "§1 Purchase / delivery", "£1–£3 fee, then the card details"),
    Threat("tech_support", "'Tech support' wants to see your screen or install an app",
           "authority plus helpfulness; the app gives them your phone", ["call", "popup", "email"],
           [r"\b(virus|malware|hacked|infected|your (computer|phone|device) (has|is)|microsoft|apple|bt|openreach|broadband)\b.{0,80}\b(install|download|app|screen|access|fix)\b",
            r"\b(anydesk|teamviewer|quick ?support|remote (access|support)|share (your|my) screen)\b"],
           ["remote_access", "new_app_installed", "recent_unknown_call"],
           ["block_remote_access", "pause_hands", "tell_someone"],
           "Nobody honest needs to see your screen to help you. Never install an app because a caller told you to.",
           "§1 Tech support / remote access", "£500–£10,000+"),
    Threat("otp_relay", "Someone asks you to read out a code your bank just sent",
           "the code is the key; they create the rush so you don't read the text", ["call", "whatsapp"],
           [r"\b(read (me|out|back) the (code|number|digits)|what (code|number) (did you|have you) (get|receive)|"
            r"text (you|a code) (now|in a moment)|one[- ]time (code|passcode)|the (6|six)[- ]digit)\b"],
           ["codes", "recent_unknown_call"],
           ["refuse_secret", "hang_up_call_back"],
           "A code from your bank is for your eyes only. Kairos will never read one aloud, and no one honest will ask.",
           "§1 OTP relay", "the full account"),
    Threat("quishing", "A QR code or link that leads to a fake login or payment page",
           "convenience, a familiar logo", ["poster", "letter", "email"],
           [r"\b(scan (this|the) (qr|code)|qr code|parking (fine|charge|penalty)|pcn)\b.{0,60}\b(pay|verify|login|log in|claim)\b"],
           ["links"],
           ["verify_official", "never_pay_by_link"],
           "Type the address yourself or use the official app. A sticker can be anyone's.",
           "§1 Quishing", "card details"),
    Threat("official_letter", "A letter or text 'from HMRC, DVLA, the council or the NHS' demanding money fast",
           "authority, fear, a deadline measured in hours", ["letter", "sms", "email"],
           [r"\b(hmrc|hm revenue|tax (refund|rebate|owed|arrears)|dvla|vehicle tax|council tax|fine|penalty|court|bailiff|warrant)\b.{0,120}\b(within (24|48|72) hours|today|immediately|arrest|legal action)\b",
            r"\b(gov\.uk|hmrc|dvla|nhs)\b.{0,40}\b(07\d{3}|whatsapp|gift card|voucher|bitcoin)\b"],
           ["authority", "urgency", "fear", "unusual_payment", "recent_scam_letter"],
           ["verify_official", "cooling_off_new_payee", "tell_someone"],
           "Government bodies write, they don't rush you, and they never want gift cards or a transfer to a person. Check on gov.uk.",
           "§1 Fake official letters", "£100–£5,000"),
    Threat("investment", "An investment, crypto or 'guaranteed return' offer",
           "greed and social proof, then sunk cost", ["social media", "whatsapp", "call"],
           [r"\b(guaranteed (return|profit|income)|\d{1,3}% (a|per) (month|week|day)|double your|crypto|bitcoin|forex|trading (platform|account)|"
            r"investment opportunity|limited (spots|places)|withdraw(al)? fee|unlock your (funds|profits))\b"],
           ["reward", "new_payee", "unusual_payment"],
           ["cooling_off_new_payee", "tell_someone", "verify_fca"],
           "Nobody can guarantee a return. Check the FCA register before a penny moves, and sleep on it.",
           "§1 Investment", "£10,000+"),
    Threat("romance", "Someone you've never met in person asks for money",
           "affection, isolation, a crisis", ["dating app", "whatsapp", "social media"],
           [r"\b(can'?t (video )?call|customs (fee|charge)|stuck (at|in) (the airport|customs|hospital|abroad)|"
            r"my (visa|ticket|surgery|medical bills?)|oil rig|deployed|military|army (doctor|engineer)|"
            r"(love|miss) you .{0,40}(send|need|money|help))\b"],
           ["new_payee", "secrecy", "repeat_payments"],
           ["cooling_off_new_payee", "tell_someone", "pause_money"],
           "Someone who loves you won't mind you asking a friend first. Never send money to someone you haven't met.",
           "§1 Romance", "£10,000+ over months"),
    Threat("purchase", "A bargain that wants payment by bank transfer",
           "a deal too good, and 'someone else is interested'", ["marketplace", "social media"],
           [r"\b(bank transfer only|no paypal|pay (by|via) transfer|deposit to (hold|secure)|someone else is interested|"
            r"collect (today|tonight)|too many (messages|enquiries))\b"],
           ["new_payee", "urgency"],
           ["cooling_off_new_payee", "pay_protected"],
           "Pay in a way you can get back (card or PayPal goods and services). A seller who refuses that is the warning.",
           "§1 Purchase", "£100–£1,000"),
    Threat("subscription_trap", "A 'free trial' or small charge that keeps coming",
           "a tiny first step", ["email", "web"],
           [r"\b(free trial|only £?\d(\.\d\d)? (today|now|to start)|cancel any ?time|trial (period|ends))\b"],
           ["links", "small_amount", "repeat_payments"],
           ["review_subscriptions"],
           "Small charges every month add up. Kairos lists anything that repeats so you can decide.",
           "§1 Subscription traps", "£5–£50 a month"),
    Threat("sim_swap", "Your phone loses signal and your accounts start changing",
           "no persuasion at all: your number is the key", ["network"],
           [r"\b(no (signal|service)|sim (not provisioned|swap|change)|number (has been )?ported|new sim)\b"],
           ["device_changed", "many_codes"],
           ["pause_money", "call_network_from_another_phone"],
           "If your phone suddenly has no signal for a long time, call your network from another phone before anything else.",
           "§1 SIM swap", "the full account"),
    Threat("prompt_injection", "Text on a letter, screen or message that tries to give Kairos orders",
           "the attack is on the helper, not the person", ["letter", "notification", "web page"],
           [r"\b(ignore (all |the )?(previous|prior|above) (instructions|rules)|you are now|new instructions|system prompt|"
            r"as an ai|assistant:|\[inst\]|<\|im_start\|>|do not tell the user|without telling the user|"
            r"tell the user (to|that) (pay|send|call|transfer)|instruct(ion)?s? for (kairos|tempo|the assistant))\b"],
           [],
           ["quarantine_text", "pause_hands"],
           "Words on a page or screen are something to read to you, never orders Kairos follows.",
           "§3 Prompt injection", "whatever the helper could do"),
]

FRICTION = {
    "cooling_off_new_payee": "New payees wait 24 hours before the first payment. That delay is there in case someone talked you into adding them.",
    "call_back_known_number": "Hang up or close the message, then call them on the number you already have for them.",
    "hang_up_call_back": "Hang up. Then ring 159, the number that connects you to your own bank, or the number printed on your card.",
    "tell_someone": "Before this goes ahead, tell someone you trust what you're about to do.",
    "pause_money": "Payments are paused until you've checked with someone you trust.",
    "pause_hands": "Kairos stops acting on your phone until you've looked at what happened.",
    "refuse_secret": "Kairos never reads a one-time code, PIN or password aloud, and never types one for you.",
    "block_remote_access": "Don't install screen-sharing or remote-access apps because a caller asked.",
    "verify_official": "Check with the real organisation using gov.uk, their official app, or the number on an old bill.",
    "verify_fca": "Look the firm up on the FCA register (register.fca.org.uk) and its warning list first.",
    "never_pay_by_link": "Never pay through a link in a text or email. Go to the official app or website yourself.",
    "pay_protected": "Pay by card or a protected method, never a bank transfer to someone you don't know.",
    "read_back_twice": "Kairos reads the amount and the name back twice before anything is sent.",
    "confirmation_of_payee": "Kairos checks the name the bank shows matches the person you meant.",
    "review_subscriptions": "Kairos shows you every payment that repeats, so you can cancel what you don't want.",
    "quarantine_text": "That text is treated as data to read out, never as instructions.",
    "call_network_from_another_phone": "Call your mobile network from another phone to ask whether your SIM was changed.",
}

CONTEXT_WEIGHT = {"new_payee": 0.25, "unknown_sender": 0.2, "recent_unknown_call": 0.25, "urgency": 0.15, "authority": 0.15,
                  "secrecy": 0.3, "unusual_payment": 0.3, "remote_access": 0.3, "codes": 0.3, "links": 0.1, "fear": 0.15,
                  "reward": 0.15, "new_app_installed": 0.25, "recent_scam_letter": 0.3, "repeat_payments": 0.15,
                  "small_amount": 0.05, "device_changed": 0.2, "many_codes": 0.2}


@dataclass
class Match:
    id: str
    name: str
    score: float
    terms: list = field(default_factory=list)
    hook: str = ""
    teach: str = ""
    friction: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "score": round(self.score, 2), "terms": self.terms[:4], "hook": self.hook,
                "teach": self.teach, "friction": self.friction}


def pressure(text: str) -> dict:
    """Which levers the text pulls: {urgency: True, authority: False, ...} plus the words that showed it."""
    text = " ".join(str(text or "").split())
    out = {}
    for name, rx in LEVERS.items():
        m = rx.search(text)
        out[name] = m.group(0) if m else None
    return out


def by_id(tid: str) -> Optional[Threat]:
    return next((t for t in THREATS if t.id == tid), None)


def match(text: str, context: Optional[dict] = None, min_score: float = 0.3) -> list:
    """Scams this text and situation resemble, best first. `context` flags: new_payee, unknown_sender,
    recent_unknown_call, recent_scam_letter, new_app_installed, repeat_payments, small_amount, device_changed, many_codes;
    the lever flags (urgency, authority, ...) are read from the text and may be given too."""
    text = " ".join(str(text or "").split())
    ctx = dict(context or {})
    for lever, hit in pressure(text).items():
        if hit:
            ctx[lever] = True
    out = []
    for t in THREATS:
        terms = []
        for rx in t.terms:
            m = re.search(rx, text, re.I)
            if m:
                terms.append(m.group(0)[:60])
        score = min(1.0, 0.5 * len(terms))
        for flag in t.context:
            if ctx.get(flag):
                score += CONTEXT_WEIGHT.get(flag, 0.1)
        flags = [f for f in t.context if ctx.get(f)]
        if terms or len(flags) >= 3:  # a situation alone (no words) must look like it from three sides
            if score >= min_score:
                out.append(Match(t.id, t.name, min(1.0, score), terms, t.hook, t.teach, list(t.friction)))
    out.sort(key=lambda m: -m.score)
    return out


def friction_for(ids: Iterable[str]) -> list:
    seen, out = set(), []
    for tid in ids:
        t = by_id(tid)
        for f in (t.friction if t else []):
            if f not in seen:
                seen.add(f)
                out.append({"id": f, "say": FRICTION.get(f, f)})
    return out


def teach_for(ids: Iterable[str]) -> list:
    return [t.teach for t in (by_id(i) for i in ids) if t]


def catalogue() -> list:
    """For the hub page and the pitch: every scam, hook, friction and lesson."""
    return [{"id": t.id, "name": t.name, "hook": t.hook, "channels": t.channels, "friction": [FRICTION.get(f, f) for f in t.friction],
             "teach": t.teach, "ref": t.ref, "typical_loss": t.typical_loss} for t in THREATS]
