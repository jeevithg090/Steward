"""Bridge draft safety checks: digits in any script, contacts never said are blocked, numbers compared, risk topics.

Pure functions - no network, no LLM, no database - so these run in milliseconds and need no mocks.
"""
import pytest

from hub.bridge_checks import check_draft, find_contacts, normalise_digits, numbers, risk_topics

CLEAN = {"blocked": [], "flags": [], "risk": [], "needs_tap": False}


# ---------- normalise_digits ----------

def test_telugu_and_devanagari_digits_become_ascii():
    assert normalise_digits("౮ గంటలకు") == "8 గంటలకు"
    assert normalise_digits("८:३० बजे") == "8:30 बजे"


@pytest.mark.parametrize("eight", ["౮", "८", "٨", "۸", "৮", "௮", "૮", "੮", "೮", "൮", "８", "8"])
def test_every_script_eight_is_8(eight):
    assert normalise_digits(f"at {eight}") == "at 8"


def test_nfc_and_non_digits_untouched():
    assert normalise_digits("café") == "café"  # NFC composes e + combining acute
    assert normalise_digits("10 m²") == "10 m²"  # superscript isn't a decimal digit
    assert normalise_digits(None) == ""  # type: ignore[arg-type]


# ---------- find_contacts ----------

def test_find_contacts_always_has_every_key():
    assert find_contacts("hello Amma") == {"urls": [], "phones": [], "emails": [], "ibans": [], "sort_codes": [],
                                           "card_numbers": []}


@pytest.mark.parametrize("text,url", [
    ("see https://www.Example.com/", "example.com"),
    ("message me on wa.me/447700900123", "wa.me/447700900123"),
    ("it's at bit.ly/AbC123.", "bit.ly/abc123"),
    ("go to example.co.uk", "example.co.uk"),
    ("the menu is on example dot com", "example.com"),
    ("example dot co dot in", "example.co.in"),
    ("click hxxp://evil[.]com/login", "evil.com/login"),
    ("find it at example.com", "example.com"),  # prose 'X at site', not the address it@example.com
])
def test_urls_including_bare_domains_and_obfuscations(text, url):
    assert find_contacts(text)["urls"] == [url]


@pytest.mark.parametrize("text", ["e.g. tomorrow", "i.e. at 8.30", "Mr.Smith called", "it costs 20.50", "a.m. or p.m.",
                                  "the dot in the picture"])
def test_url_false_positive_guards(text):
    assert find_contacts(text)["urls"] == []


@pytest.mark.parametrize("text,phone", [
    ("call 07700 900123", "07700900123"),
    ("ring (020) 7946 0958", "02079460958"),
    ("+44 (0)20 7946 0958", "442079460958"),
    ("0044 7700 900123", "447700900123"),
    ("+91 98765-43210", "919876543210"),
    ("number 98765 43210", "9876543210"),
    ("నా నంబర్ ౦౭౭౦౦ ౯౦౦౧౨౩", "07700900123"),  # Telugu digits
    ("at 2 07700 900123", "07700900123"),  # a stray number glued in front isn't swallowed
])
def test_phones_in_uk_and_international_formats(text, phone):
    assert find_contacts(text)["phones"] == [phone]


@pytest.mark.parametrize("text", ["meet at 08:30", "bring £20", "25/10/2026", "on 25-10-2026 at 8 30",
                                  "3 days", "1,00,000 rupees", "from 2024 to 2026"])
def test_phone_false_positive_guards(text):
    contacts = find_contacts(text)
    assert contacts["phones"] == [] and contacts["card_numbers"] == []


@pytest.mark.parametrize("text,email", [
    ("ravi at gmail dot com", "ravi@gmail.com"),
    ("Ravi.K@Example.co.uk", "ravi.k@example.co.uk"),
    ("ravi (at) gmail [dot] com", "ravi@gmail.com"),
    ("write to amma.r at outlook dot com please", "amma.r@outlook.com"),
])
def test_emails_including_spelled_out(text, email):
    contacts = find_contacts(text)
    assert contacts["emails"] == [email]
    assert contacts["urls"] == []  # the address's domain isn't also reported as a link


def test_iban_with_spaces_lowercase_and_checksum():
    assert find_contacts("pay GB82 WEST 1234 5698 7654 32 today")["ibans"] == ["GB82WEST12345698765432"]
    assert find_contacts("de89370400440532013000")["ibans"] == ["DE89370400440532013000"]
    assert find_contacts("pay GB82 WEST 1234 5698 7654 33")["ibans"] == []  # bad check digits
    assert find_contacts("SW19 town hall area near here")["ibans"] == []  # postcode + 4-letter words


def test_sort_codes_dashed_or_near_the_words():
    assert find_contacts("use 40-47-84")["sort_codes"] == ["404784"]
    assert find_contacts("sort code 40 47 84, account 31926819")["sort_codes"] == ["404784"]
    assert find_contacts("the scores were 40 47 84")["sort_codes"] == []


def test_card_numbers_need_luhn():
    assert find_contacts("card 4111 1111 1111 1111")["card_numbers"] == ["4111111111111111"]
    assert find_contacts("amex 3782-822463-10005")["card_numbers"] == ["378282246310005"]
    assert find_contacts("card 4111 1111 1111 1112")["card_numbers"] == []
    assert find_contacts("for 3 days")["card_numbers"] == []


# ---------- numbers ----------

@pytest.mark.parametrize("text,expected", [
    ("౮ గంటలకు", ["8"]),
    ("८ बजे", ["8"]),
    ("8pm", ["20:00"]),
    ("08:30", ["8:30"]),
    ("8.30", ["8:30"]),  # UK-style time
    ("half past eight", ["8:30"]),
    ("£20", ["£20"]),
    ("20 pounds", ["£20"]),
    ("20.50", ["20.50"]),
    ("₹500", ["₹500"]),
    ("500 రూపాయలు", ["₹500"]),
    ("50p", ["£0.50"]),
    ("25/10", ["25/10"]),
    ("25 Oct", ["25/10"]),
    ("25th October 2026", ["25/10/2026"]),
    ("twenty five", ["25"]),
    ("two hundred and fifty", ["250"]),
    ("a thousand", ["1000"]),
    ("1,00,000 and 10,000", ["100000", "10000"]),
    ("3 days", ["3"]),
    ("the one you liked", []),  # a lone 'one' is a pronoun
    ("call 07700 900123 at 8", ["8"]),  # phone digits are contacts, not numbers
])
def test_numbers_canonical_forms(text, expected):
    assert numbers(text) == expected


# ---------- risk_topics ----------

@pytest.mark.parametrize("text,topics", [
    ("అమ్మా, డబ్బులు పంపించు", ["money"]),  # Telugu: send money
    ("పైసలు కావాలి", ["money"]),
    ("paisa bhej do", ["money"]),  # romanised Hindi
    ("రేపు ఆసుపత్రికి వెళ్ళాలి", ["health"]),  # Telugu: to the hospital tomorrow
    ("मुझे अस्पताल जाना है", ["health"]),  # Hindi: I have to go to hospital
    ("doctor ne dawai di", ["health"]),
    ("vakil se baat karo", ["legal"]),
    ("court date is fixed", ["legal"]),
    ("my boss cut my salary", ["work"]),
    ("జీతం వచ్చింది", ["work"]),  # Telugu: salary came
    ("send £20 for the hospital", ["money", "health"]),
    ("Tell Bill I'll be home late", []),
])
def test_risk_topics_in_english_hindi_and_telugu(text, topics):
    assert risk_topics(text) == topics


# ---------- check_draft ----------

def test_clean_english_draft_has_no_issues():
    result = check_draft("Tell Amma I'll be home late tonight, don't wait up for dinner",
                         "Hi Amma, I'll be home late tonight. Please don't wait up for dinner.")
    assert result == CLEAN


def test_telugu_digits_match_the_drafts_ascii_digits():
    assert check_draft("అమ్మా, నేను ౮ గంటలకు ఇంటికి వస్తాను", "Amma, I'll be home at 8.") == CLEAN
    assert check_draft("tell amma I'll call at 8", "అమ్మా, ౮ గంటలకు ఫోన్ చేస్తాను") == CLEAN


def test_number_mismatch_said_8_draft_9():
    result = check_draft("అమ్మా, నేను ౮ గంటలకు ఇంటికి వస్తాను", "Amma, I'll be home at 9.")
    assert result["flags"] == [{"kind": "number", "value": "9", "in_transcript": False},
                               {"kind": "missing_number", "value": "8", "in_transcript": True}]
    assert result["needs_tap"] is True and result["blocked"] == []


def test_missing_number_is_flagged():
    result = check_draft("tell amma I'll call at 8 and bring twenty pounds", "Amma, I'll call you at 8.")
    assert result["flags"] == [{"kind": "missing_number", "value": "£20", "in_transcript": True}]
    assert result["needs_tap"] is True


@pytest.mark.parametrize("said,drafted", [
    ("call at 8", "I'll call at 8pm"),  # composer adding pm to a bare 8 is fine
    ("call at 8", "I'll call at 8:00"),
    ("home by 8.30", "home by 8:30"),
    ("send 20", "send £20"),
    ("on the 25th of October", "on 25/10"),
    ("in two hours", "in 2 hours"),
])
def test_reformatted_numbers_are_not_flagged(said, drafted):
    assert check_draft(said, drafted)["flags"] == []


@pytest.mark.parametrize("said,drafted,value", [
    ("call at 8am", "I'll call at 8pm", "20:00"),
    ("send 20 pounds", "send ₹20", "₹20"),
    ("on 25 October", "on 26 October", "26/10"),
])
def test_changed_numbers_are_flagged(said, drafted, value):
    flags = check_draft(said, drafted)["flags"]
    assert {"kind": "number", "value": value, "in_transcript": False} in flags


def test_url_never_said_is_blocked():
    result = check_draft("Tell Amma to check the recipe", "Hi Amma, check the recipe at bit.ly/3xYz")
    assert result["blocked"] == [{"kind": "url", "value": "bit.ly/3xyz"}]
    assert result["flags"] == []  # the '3' inside the link isn't a number


def test_obfuscated_url_in_draft_is_still_blocked():
    result = check_draft("tell amma hi", "Hi Amma! Log in at evil dot com to see the photos")
    assert result["blocked"] == [{"kind": "url", "value": "evil.com"}]


def test_url_they_did_say_is_allowed():
    assert check_draft("Tell Amma the recipe is on example dot com",
                       "Hi Amma, the recipe is at https://www.example.com/")["blocked"] == []
    assert check_draft("the menu is at example.com/menu", "Menu: example.com")["blocked"] == []


def test_phone_said_in_another_format_is_allowed_but_new_phone_is_blocked():
    assert check_draft("tell Ravi my number is 07700 900123", "Hi Ravi, my number is +44 7700 900123.") == CLEAN
    result = check_draft("tell Ravi to call me", "Hi Ravi, call me on 07700 900456.")
    assert result["blocked"] == [{"kind": "phone", "value": "07700900456"}]


def test_spelled_out_email_said_allows_the_written_address():
    assert check_draft("tell Sam my email is ravi at gmail dot com", "Sam, my email is ravi@gmail.com") == CLEAN
    result = check_draft("tell Sam my email changed", "Sam, my new email is ravi@evil.com")
    assert result["blocked"] == [{"kind": "email", "value": "ravi@evil.com"}]


def test_iban_sort_code_and_card_never_said_are_blocked():
    result = check_draft("tell Sam to send the twenty pounds",
                         "Sam, please send £20 to GB82 WEST 1234 5698 7654 32, sort code 40-47-84, "
                         "or card 4111 1111 1111 1111.")
    kinds = {(b["kind"], b["value"]) for b in result["blocked"]}
    assert kinds == {("iban", "GB82WEST12345698765432"), ("sort_code", "404784"),
                     ("card_number", "4111111111111111")}
    assert result["risk"] == ["money"] and result["needs_tap"] is True


def test_iban_they_said_with_spaces_is_allowed():
    result = check_draft("my IBAN is GB82 WEST 1234 5698 7654 32, tell Sam",
                         "Sam, my IBAN is GB82WEST12345698765432.")
    assert result["blocked"] == [] and result["flags"] == []


def test_risk_in_telugu_or_hindi_transcript_needs_a_tap():
    result = check_draft("అమ్మా, డబ్బులు పంపించాను", "Amma, I've sent the money.")
    assert result == {"blocked": [], "flags": [], "risk": ["money"], "needs_tap": True}
    result = check_draft("माँ को बताओ मुझे अस्पताल जाना है", "Maa, I have to go to the hospital.")
    assert result["risk"] == ["health"] and result["needs_tap"] is True


def test_risk_found_in_the_draft_alone_counts():
    result = check_draft("tell my manager I'm running late", "Hi, I'm running late. Sorry!")
    assert result["risk"] == ["work"]


def test_result_shape_is_stable():
    result = check_draft("", "")
    assert result == CLEAN
    assert list(result) == ["blocked", "flags", "risk", "needs_tap"]


# ---------- review: holes an injected draft could use, and realistic inputs that were misread ----------

TOLD = "tell amma I'll be home late"


@pytest.mark.parametrize("draft,kind,value", [
    ("write to josé@evil.com", "email", "josé@evil.com"),  # non-ASCII local part used to hide the whole address
    ("write to аdmin@evil.com", "email", "аdmin@evil.com"),  # Cyrillic а
    ("log in at аmazon.com", "url", "аmazon.com"),  # lookalike domain: blocked, never read as amazon.com
    ("photos at amma-photos.it", "url", "amma-photos.it"),  # TLDs outside the known list
    ("photos at evil.to", "url", "evil.to"),
    ("photos at photos.family", "url", "photos.family"),
    ("photos at EVIL.IS", "url", "evil.is"),
    ("visit evil.\u200bcom", "url", "evil.com"),  # zero-width space
    ("visit evil\u00ad.com", "url", "evil.com"),  # soft hyphen
    ("visit evil。com", "url", "evil.com"),  # ideographic full stop
    ("visit ｅｖｉｌ．ｃｏｍ", "url", "evil.com"),  # fullwidth
    ("open tg://resolve?domain=scammer", "url", "tg://resolve?domain=scammer"),
    ("call 07700.900.456", "phone", "07700900456"),
    ("call 0 7 7 0 0 9 0 0 4 5 6", "phone", "07700900456"),
    ("call zero seven seven double oh nine double oh four five six", "phone", "07700900456"),
    ("Call07700900456", "phone", "07700900456"),
    ("pay GB82-WEST-1234-5698-7654-32", "iban", "GB82WEST12345698765432"),
])
def test_hidden_contacts_in_a_draft_are_blocked(draft, kind, value):
    assert {"kind": kind, "value": value} in check_draft(TOLD, draft)["blocked"]


@pytest.mark.parametrize("text", [
    "Ravi finished his B.Com and B.Tech", "Dr.Rao and Mr.Smith agreed", "Hi Amma.How are you?", "see photo.jpg",
    "at 10.am", "at 8 on the dot me and Ravi", "a dot in the corner", "pi is 3.14159265358979", "on 25.10.2026 at 8.30",
    "Rs500000000", "flight BA256 at 18:45", "Prof.Kumar and Smt.Lakshmi", "version 2.0.1",
])
def test_no_contacts_in_everyday_text(text):
    assert not any(find_contacts(text).values())


@pytest.mark.parametrize("said,drafted", [
    ("tell Sam my number is oh seven seven double oh nine double oh one two three", "Sam, my number is 07700 900123."),
    ("tell Sam my number is 07700 900123", "Sam, my number is 07700.900.123"),
    ("tell Sam my email is ravi dot kumar at gmail dot com", "Sam, my email is ravi.kumar@gmail.com"),
    ("tell Sam to check sbi dot in", "Sam, check sbi.in"),
    ("tell Sam to check w w w.example.com", "Sam, check www.example.com"),
    ("tell Sam the site is amma-recipes.it", "Sam, the site is amma-recipes.it"),
])
def test_contacts_said_in_spoken_forms_are_allowed(said, drafted):
    assert check_draft(said, drafted)["blocked"] == []


def test_new_address_at_a_domain_only_said_in_an_address_is_blocked():
    said = "tell Sam my email is ravi at gmail dot com"
    result = check_draft(said, "Sam, my email is ravi at gmail dot com, or use scammer at gmail dot com")
    assert result["blocked"] == [{"kind": "email", "value": "scammer@gmail.com"}]
    # 'X at site' is still fine as prose when the person named the site itself
    assert check_draft("the recipe is on example.com", "the recipe at example.com is lovely")["blocked"] == []


@pytest.mark.parametrize("text,expected", [
    ("half eight", ["8:30"]),  # British for 8:30
    ("saadhe 8 baje", ["8:30"]),  # Hindi: half past 8
    ("साढ़े आठ बजे", ["8:30"]),
    ("sawa 8", ["8:15"]),
    ("paune 9", ["8:45"]),
    ("saadhe 3 lakh", ["350000"]),  # an amount, not a time
    ("dedh lakh rupaye", ["₹150000"]),
    ("dhai baje", ["2:30"]),
    ("2 lakh", ["200000"]),
    ("5 thousand", ["5000"]),
    ("10k", ["10000"]),
    ("5 వేల రూపాయలు", ["₹5000"]),
    ("ఎనిమిది గంటలకు", ["8"]),  # Telugu number word before a unit
    ("आठ बजे", ["8"]),
    ("aath baje", ["8"]),
    ("wyth o'r gloch", ["8"]),  # Welsh
    ("paisa bhej do", []),  # 'do' = give, no unit after it
    ("do dinner at 8", ["8"]),
])
def test_numbers_more_spoken_forms(text, expected):
    assert numbers(text) == expected


@pytest.mark.parametrize("said,drafted", [
    ("అమ్మా, నేను ఎనిమిది గంటలకు ఇంటికి వస్తాను", "Amma, I'll be home at 8."),
    ("tell amma I'll be home at 8", "అమ్మా, నేను ఎనిమిది గంటలకు ఇంటికి వస్తాను"),
    ("माँ को बोलो मैं साढ़े आठ बजे आऊँगा", "Maa, I'll come at 8:30."),
    ("Dywed wrth Mam bydda i adref erbyn wyth o'r gloch", "Mam, I'll be home by 8."),
    ("tell mum I'll be there at half eight", "Mum, I'll be there at 8:30."),
    ("tell Ravi to send 2 lakh rupees", "Ravi, please send ₹2,00,000."),
])
def test_cross_language_numbers_match(said, drafted):
    assert check_draft(said, drafted)["flags"] == []


def test_cross_language_changed_number_is_flagged():
    flags = check_draft("माँ को बोलो मैं आठ बजे आऊँगा", "माँ, मैं नौ बजे आऊँगा।")["flags"]
    assert flags == [{"kind": "number", "value": "9", "in_transcript": False},
                     {"kind": "missing_number", "value": "8", "in_transcript": True}]


@pytest.mark.parametrize("text,topics", [
    ("Mae angen arian arnaf", ["money"]),  # Welsh: I need money
    ("dw i yn yr ysbyty", ["health"]),  # Welsh: I'm in hospital
    ("mae'r heddlu yma", ["legal"]),  # Welsh: the police are here
    ("mae fy nghyflog yn hwyr", ["work"]),  # Welsh: my salary is late
    ("send the funds by wire", ["money"]),
    ("buy an Amazon voucher and send me the code", ["money"]),
    ("tell them my password", ["money"]),
    ("I'm at the hos\u200bpital", ["health"]),  # zero-width space can't hide a topic
])
def test_risk_topics_welsh_scam_words_and_invisibles(text, topics):
    assert risk_topics(text) == topics


@pytest.mark.parametrize("hostile", ["a-" * 25000 + ".com", "1-" * 25000, "a." * 25000 + "com", "1 " * 25000,
                                     "oh seven " * 6000, "a dot " * 8000 + "b at x.com", "do " * 16000 + "baje"])
def test_hostile_input_stays_fast(hostile):
    import time
    start = time.perf_counter()
    check_draft(hostile, hostile)
    assert time.perf_counter() - start < 2.0
