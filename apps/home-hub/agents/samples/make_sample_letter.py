#!/usr/bin/env python3
"""Render realistic sample letters as photos, for tests and the demo (no real people's data).

    .venv/bin/python agents/samples/make_sample_letter.py          -> agents/samples/*.png

  water_credit.png   the pitch: the water company says you overpaid, nothing to pay this month
  council_tax.png    a reminder with a deadline and an amount
  nhs_appointment.png a hospital appointment letter
  scam_hmrc.png      a fake "HMRC refund" letter with the usual scam signs
Fictional organisations' details are invented; a real one's style is imitated only loosely.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
W, H = 1240, 1754  # A4 at 150 dpi

FONT_CANDIDATES = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Verdana.ttf",
                   "/Library/Fonts/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
BOLD_CANDIDATES = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
                   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font(size: int, bold: bool = False):
    for p in (BOLD_CANDIDATES if bold else FONT_CANDIDATES):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def render(name: str, header: str, header_colour: str, lines: list, footer: str = "") -> Path:
    im = Image.new("RGB", (W, H), (252, 251, 247))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 110], fill=header_colour)
    d.text((70, 30), header, font=font(44, True), fill="white")
    y = 170
    for item in lines:
        if isinstance(item, tuple):
            text, kind = item
        else:
            text, kind = item, "p"
        if kind == "gap":
            y += 26
            continue
        f = {"h": font(36, True), "p": font(27), "small": font(22), "big": font(40, True)}[kind]
        colour = (30, 30, 30) if kind != "small" else (90, 90, 90)
        for ln in text.split("\n"):
            d.text((70, y), ln, font=f, fill=colour)
            y += f.size + 12
        y += 8
    if footer:
        d.line([70, H - 120, W - 70, H - 120], fill=(180, 180, 180), width=2)
        d.text((70, H - 100), footer, font=font(20), fill=(100, 100, 100))
    # a little camera-like imperfection: slight tint and a soft shadow edge
    out = HERE / f"{name}.png"
    im.save(out, optimize=True)
    return out


def main() -> int:
    made = [
        render("water_credit", "Isis Water", "#1b5e8a", [
            ("Mrs P Okafor\n14 Marston Road\nOxford OX3 0DE", "p"), ("gap", "gap"),
            ("Account number: 2041 8873 11        Date: 17 October 2026", "small"),
            ("Your account is in credit", "h"),
            ("Dear Mrs Okafor,", "p"),
            ("Thank you for your payment of £68.20 received on 2 October 2026.\nYour bill for September was £30.00, so you have paid £38.20 too much.", "p"),
            ("You do not need to pay anything this month.", "big"),
            ("We have left the £38.20 credit on your account. It will be taken off your next bill\nin December. If you would rather have it refunded to your bank, call us free on\n0800 316 9800 (Monday to Friday, 8am to 6pm) and we will arrange it.", "p"),
            ("There is nothing you need to do.", "p"), ("gap", "gap"),
            ("Yours sincerely,\nCustomer accounts team, Isis Water", "p"),
        ], "Isis Water Ltd, Thames Street, Oxford OX1 1ZZ · Registered in England 01234567 · isiswater.co.uk"),
        render("council_tax", "Oxford City Council", "#2e7d32", [
            ("Mr D Rahman\n7 Cowley Road\nOxford OX4 1HP", "p"), ("gap", "gap"),
            ("Council Tax account: 70012345678        Date: 20 October 2026", "small"),
            ("Reminder: Council Tax instalment overdue", "h"),
            ("Dear Mr Rahman,", "p"),
            ("Our records show that your Council Tax instalment of £142.00, due on 1 October 2026,\nhas not been paid.", "p"),
            ("Please pay £142.00 by 3 November 2026.", "big"),
            ("If we do not receive payment by then, you may lose the right to pay by instalments\nand the full amount for the year (£1,278.00) could become due.", "p"),
            ("How to pay: online at oxford.gov.uk/counciltax, by phone on 01865 249811 (24 hours),\nor at any PayPoint with this letter. Please quote your account number.", "p"),
            ("If you have paid in the last few days, thank you; please ignore this letter.\nIf you are struggling to pay, call us on 01865 249811: we can spread the payments.", "p"),
            ("gap", "gap"), ("Revenues and Benefits, Oxford City Council", "p"),
        ], "Oxford City Council, St Aldate's Chambers, 109 St Aldate's, Oxford OX1 1DS · oxford.gov.uk"),
        render("nhs_appointment", "Oxford University Hospitals  NHS", "#005eb8", [
            ("Miss A Jones\n22 Iffley Road\nOxford OX4 1EA", "p"), ("gap", "gap"),
            ("Hospital number: 1234567        NHS number: 943 476 5919        Date: 15 October 2026", "small"),
            ("Your appointment", "h"),
            ("Dear Miss Jones,", "p"),
            ("You have an appointment at the Eye Hospital outpatients department:", "p"),
            ("Tuesday 10 November 2026 at 9:40am\nJohn Radcliffe Hospital, West Wing, Level 3, Clinic 4", "big"),
            ("Please bring your glasses and a list of any medicines you take. Your eyes may be dilated\nwith drops, so please do not drive for 4 hours afterwards.", "p"),
            ("Please arrive 10 minutes early. If you cannot attend, call 01865 234567 as soon as\npossible so we can offer the time to someone else.", "p"),
            ("gap", "gap"), ("Outpatient appointments team", "p"),
        ], "Oxford University Hospitals NHS Foundation Trust, Headley Way, Oxford OX3 9DU · ouh.nhs.uk"),
        render("scam_hmrc", "HM Revenue & Customs", "#008476", [
            ("Dear Taxpayer,", "p"), ("gap", "gap"),
            ("Ref: TX-REFUND-88213        Date: 21 October 2026", "small"),
            ("You are owed a tax refund of £563.88", "h"),
            ("After the last annual calculation of your fiscal activity we have determined that you are\neligible to recieve a tax refund of £563.88.", "p"),
            ("To claim, verify your bank card details within 48 hours at:\nwww.hmrc-refund-claims.co.uk", "big"),
            ("If you do not verify within 48 hours the refund will be cancelled and legal action\nmay be taken regarding unpaid tax. For assistance WhatsApp our agent on 07700 900123.", "p"),
            ("gap", "gap"), ("HMRC Refund Department", "p"),
        ], "HM Revenue and Customs"),
    ]
    for p in made:
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
