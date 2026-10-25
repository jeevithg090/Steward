"""Generate the "Tempo Scam Spotter" shortcut: Scam Shield on an iPhone (docs/scam-shield.md).

    uv run python apps/shortcuts/build_scam_spotter.py             # Tempo-Scam-Spotter.shortcut
    uv run python apps/shortcuts/build_scam_spotter.py --unsigned   # the plist only

iOS gives no app a way to read other apps' notifications, so the iPhone cannot run the filter in
the background the way the Android node does. What it can do, with no native app and no review:

- **Share sheet:** on any text or email, Share → Tempo Scam Spotter. The message goes to the
  Gateway's POST /scam/check and the phone speaks the answer with its own voice (Speak Text).
- **Automation:** a Personal Automation "Message contains `http`" → Run Shortcut → Tempo Scam
  Spotter, set to *Run Immediately*, checks every text with a link as it arrives (README).

The message leaves the phone here (unlike the Android node, which sends four derived fields):
the shortcut cannot run the model or the link rules itself, so it says so on first run and asks.
Placeholders, never a real token; fill the Get Contents of URL action after importing.
"""

from __future__ import annotations

import argparse
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from build_shortcut import (
    HAS_ANY_VALUE,
    HAS_NO_VALUE,
    SHORTCUT_INPUT,
    Builder,
    act,
    attachment,
    fields,
    output,
    text,
)

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "Tempo-Scam-Spotter.shortcut"
PLACEHOLDERS = {
    "url": "https://YOUR-TUNNEL.trycloudflare.com/scam/check",
    "token": "CHANGE-ME",
    "user_id": "u_you",
    "language": "en",  # en | hi | pa | pl | ur | cy: the Gateway answers in this language
}
SPEECH_LANGUAGES = {
    "en": "en-GB",
    "hi": "hi-IN",
    "pa": "pa-IN",
    "pl": "pl-PL",
    "ur": "ur-PK",
    "cy": "cy-GB",
}


def actions(settings: dict[str, str]) -> Any:
    b = Builder({})
    # 1. The message: the share sheet's text, or the automation's message.
    b.set_variable("Message", SHORTCUT_INPUT)
    # 2. Nothing to check? Say so and stop.
    grouping = b.if_(SHORTCUT_INPUT, HAS_NO_VALUE)
    b.actions.append(
        act(
            "speaktext",
            WFText=text("Share a message with me and I will check it."),
            WFSpeakTextWait=True,
        )
    )
    b.actions.append(act("exit"))
    b.otherwise(grouping)
    b.end_if(grouping)
    # 3. Ask the Gateway: the same check as the phone, the SMS word and the voice line.
    sent = b.add(
        "downloadurl",
        WFURL=settings["url"],
        WFHTTPMethod="POST",
        ShowHeaders=True,
        WFHTTPHeaders=fields([("Authorization", text(f"Bearer {settings['token']}"))]),
        WFHTTPBodyType="JSON",
        WFJSONValues=fields(
            [
                ("text", text(attachment({"Type": "Variable", "VariableName": "Message"}))),
                ("user_id", text(settings["user_id"])),
                ("language", text(settings["language"])),
            ]
        ),
    )
    say = b.add(
        "getvalueforkey",
        WFInput=attachment(output(sent, "Contents of URL")),
        WFGetDictionaryValueType="Value",
        WFDictionaryKey=text("say"),
    )
    # 4. Speak the Gateway's words, slowly, in the chosen language; show them too.
    grouping = b.if_(output(say, "Dictionary Value"), HAS_ANY_VALUE)
    b.actions.append(
        act(
            "speaktext",
            WFText=text(output(say, "Dictionary Value")),
            WFSpeakTextLanguage=SPEECH_LANGUAGES.get(settings["language"], "en-GB"),
            WFSpeakTextRate=0.45,
            WFSpeakTextWait=True,
        )
    )
    b.notify("Tempo Scam Shield", output(say, "Dictionary Value"))
    b.otherwise(grouping)
    b.actions.append(
        act(
            "speaktext",
            WFText=text("I could not check that message. Don't act on it until I can."),
            WFSpeakTextWait=True,
        )
    )
    b.notify("Tempo couldn't check it", output(sent, "Contents of URL"))
    b.end_if(grouping)
    return b.actions


def workflow(settings: dict[str, str]) -> dict[str, Any]:
    return {
        "WFWorkflowClientVersion": "2700.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 59771,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFURLContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowNoInputBehavior": {
            "Name": "WFWorkflowNoInputBehaviorGetClipboard",
            "Parameters": {},
        },
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions(settings),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Tempo Scam Spotter shortcut file.")
    parser.add_argument("--unsigned", action="store_true", help="write the plist, don't sign")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    for key, default in PLACEHOLDERS.items():
        parser.add_argument(f"--{key.replace('_', '-')}", dest=key, default=default)
    args = parser.parse_args(argv)
    settings = {key: getattr(args, key) for key in PLACEHOLDERS}
    if settings["token"] != PLACEHOLDERS["token"]:
        print("Note: this file now holds a real token. Don't share or commit it.")
    plist = plistlib.dumps(workflow(settings), fmt=plistlib.FMT_BINARY)
    if args.unsigned:
        args.output.write_bytes(plist)
        print(f"wrote {args.output} (unsigned: iOS won't import it until it's signed)")
        return 0
    if shutil.which("shortcuts") is None:
        print("`shortcuts sign` needs macOS 12 or later; use --unsigned elsewhere")
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / "Tempo Scam Spotter.shortcut"
        unsigned.write_bytes(plist)
        sign = ["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned)]
        for _ in range(3):  # Apple's signing service sometimes answers HTTP 500 once
            done = subprocess.run([*sign, "--output", str(args.output)], check=False)  # noqa: S603
            if done.returncode == 0:
                print(f"wrote {args.output} (signed for anyone: AirDrop it to an iPhone)")
                return 0
    return 1


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    sys.exit(main())
