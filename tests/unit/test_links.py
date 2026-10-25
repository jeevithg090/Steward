"""Links in a message (docs/scam-shield.md §5): found, named, and labelled in plain words."""

from __future__ import annotations

import pytest

from tempo_core.links import (
    FINDING_WORDS,
    STRONG,
    WEAK,
    brand_in,
    find_links,
    fold,
    link_hosts,
    registrable,
)


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("www.oxford.gov.uk", "oxford.gov.uk"),
        ("hmrc.gov.uk", "hmrc.gov.uk"),
        ("hmrc-refunds-gov.uk", "hmrc-refunds-gov.uk"),
        ("secure.halifax.co.uk", "halifax.co.uk"),
        ("a.b.sbi.co.in", "sbi.co.in"),
        ("evri-track.co", "evri-track.co"),
        ("bit.ly", "bit.ly"),
        ("192.168.4.20", "192.168.4.20"),
    ],
)
def test_registrable_domain(host: str, expected: str) -> None:
    assert registrable(host) == expected


def test_a_brand_in_a_domain_that_is_not_the_brands_is_a_look_alike() -> None:
    assert brand_in("hmrc-refunds-gov.uk") == "hmrc"
    assert brand_in("royal-mail-redelivery.com") == "royalmail"
    assert brand_in("secure.hsbc.co.uk.verify-id.com") == "hsbc"
    assert brand_in("secure.halifax.co.uk") is None  # the brand's own domain
    assert brand_in("tax.service.gov.uk") is None
    assert brand_in("severity.com") is None  # "evri" inside a word is not the brand
    assert brand_in("johnson.com") is None  # three-letter brands need a whole label


def test_links_are_found_however_they_are_written() -> None:
    text = (
        "Claim at http://hmrc-refunds-gov.uk/claim or hxxps://evri[.]com/track, "
        "see www.oxford.gov.uk/counciltax and rb.gy/4k2q."
    )
    found = find_links(text)
    assert [link.registrable for link in found] == [
        "hmrc-refunds-gov.uk", "evri.com", "oxford.gov.uk", "rb.gy",
    ]  # fmt: skip
    assert "brand_lookalike:hmrc" in found[0].findings and found[0].suspicious
    assert found[1].findings == ("defanged",) and not found[1].suspicious
    assert found[2].findings == () and found[3].findings == ("shortener",)


def test_look_alike_letters_are_a_finding_not_a_pass() -> None:
    cyrillic = find_links("Verify at p\u0430ypal.com/verify")  # a Cyrillic a
    digits = find_links("Log in at paypa1.com now")
    puny = find_links("See xn--pypal-4ve.com")
    assert cyrillic[0].registrable == "xn--pypal-4ve.com"  # the real host, as a sandbox fetches it
    assert "punycode" in cyrillic[0].findings and cyrillic[0].suspicious
    assert digits[0].registrable == "paypa1.com" and "punycode" in digits[0].findings
    assert "punycode" in puny[0].findings


def test_bare_internet_addresses_app_files_and_cheap_endings() -> None:
    (apk,) = find_links("Install from http://192.168.4.20/loan.apk today")
    assert {"ip_address", "apk_download", "insecure_http"} <= set(apk.findings)
    (cheap,) = find_links("Your prize: claim-now.top")
    assert cheap.findings == ("suspicious_tld",)
    (deep,) = find_links("login at secure.hsbc.co.uk.verify-id.com/login")
    assert {"brand_lookalike:hsbc", "deep_subdomains", "pressure_path"} == set(deep.findings)


def test_sentences_with_missing_spaces_are_not_links() -> None:
    assert find_links("Pay now.It is due. Thanks.Ring me at 10.30, cost 1.99") == ()
    assert find_links("security@lloyds-online-help.co wrote to you") == ()  # an email, not a link
    assert find_links("Thanks.Help me out") == ()


def test_only_five_hosts_leave_in_order_and_without_repeats() -> None:
    text = "a.com/x a.com/y " + " ".join(f"http://h{i}.com/" for i in range(9))
    assert link_hosts(text) == ["a.com", "h0.com", "h1.com", "h2.com", "h3.com"]


def test_findings_have_plain_words_and_a_strength() -> None:
    assert set(FINDING_WORDS) == STRONG | WEAK
    (link,) = find_links("http://royalmail-redelivery.com/pay")
    assert link.words()[0] == "its link only looks like Royalmail's"


def test_fold_imitates_what_the_eye_sees() -> None:
    assert fold("P\u0430yPal") == "paypal"  # a Cyrillic a
    assert fold("G00GLE") == "google" and fold("paypa1.com") == "paypal.com"
    assert fold("mp3.com") == "mp3.com" and fold("covid19") == "covid19"  # digits that are digits
