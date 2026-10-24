"""Generate the "Tempo Delay Spotter" shortcut file, then sign it with macOS `shortcuts sign`.

    uv run python apps/shortcuts/build_shortcut.py            # writes Tempo-Delay-Spotter.shortcut
    uv run python apps/shortcuts/build_shortcut.py --unsigned  # the plist only (any OS)

The actions are the README's hand-built shortcut, block for block, with the regexes from
fixtures/patterns.yaml and the Stations dictionary from fixtures/stations.yaml, so the file and
the README can't drift apart. It holds placeholders, never a real token: after importing, fill
in the Get Contents of URL action (README, "Fast path").

Experimental: the plist format is Apple's private one, so check the import on a device.
"""

from __future__ import annotations

import argparse
import plistlib
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
OUTPUT = HERE / "Tempo-Delay-Spotter.shortcut"
HAS_ANY_VALUE, HAS_NO_VALUE = 100, 101  # WFCondition codes
PLACEHOLDERS = {
    "url": "https://YOUR-TUNNEL.trycloudflare.com/missions",
    "token": "CHANGE-ME",
    "user_id": "u_you",
    "display_name": "Your name",
    "phone": "",
    "fare_gbp": "28.40",
    "time_value_gbp_h": "18",
}

Value = dict[str, Any]


def _id() -> str:
    return str(uuid.uuid4()).upper()


def output(action_uuid: str, name: str) -> Value:
    return {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}


def variable(name: str) -> Value:
    return {"Type": "Variable", "VariableName": name}


SHORTCUT_INPUT: Value = {"Type": "ExtensionInput"}
CURRENT_DATE: Value = {"Type": "CurrentDate"}


def attachment(value: Value) -> Value:
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts: str | Value) -> Value:
    """A text field: plain strings with variables in between (U+FFFC marks each variable)."""
    string, attachments = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            attachments[f"{{{len(string.encode('utf-16-le')) // 2}, 1}}"] = part
            string += "￼"
    return {
        "Value": {"string": string, "attachmentsByRange": attachments},
        "WFSerializationType": "WFTextTokenString",
    }


def fields(items: list[tuple[str, Value]]) -> Value:
    """A dictionary editor (Dictionary action, JSON body, headers): every value is text."""
    return {
        "Value": {
            "WFDictionaryFieldValueItems": [
                {"WFItemType": 0, "WFKey": text(key), "WFValue": value} for key, value in items
            ]
        },
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def act(identifier: str, **parameters: Any) -> Value:
    return {
        "WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}",
        "WFWorkflowActionParameters": parameters,
    }


class Builder:
    def __init__(self, patterns: dict[str, Any]) -> None:
        self.actions: list[Value] = []
        self.patterns = patterns

    def add(self, identifier: str, **parameters: Any) -> str:
        action_uuid = _id()
        self.actions.append(act(identifier, UUID=action_uuid, **parameters))
        return action_uuid

    def set_variable(self, name: str, value: Value) -> None:
        self.actions.append(act("setvariable", WFVariableName=name, WFInput=attachment(value)))

    def match(self, pattern: str) -> str:
        p = self.patterns[pattern]
        return self.add(
            "text.match",
            WFMatchTextPattern=p["regex"],
            WFMatchTextCaseSensitive=bool(p["case_sensitive"]),
            text=text(variable("AlertText")),
        )

    def group(self, matches: str, index: int) -> str:
        return self.add(
            "text.match.getgroup",
            matches=attachment(output(matches, "Matches")),
            WFGetGroupType="Group At Index",
            WFGroupIndex=index,
        )

    def if_(self, value: Value, condition: int) -> str:
        grouping = _id()
        self.actions.append(
            act(
                "conditional",
                GroupingIdentifier=grouping,
                WFControlFlowMode=0,
                WFCondition=condition,
                WFInput={"Type": "Variable", "Variable": attachment(value)},
            )
        )
        return grouping

    def otherwise(self, grouping: str) -> None:
        self.actions.append(act("conditional", GroupingIdentifier=grouping, WFControlFlowMode=1))

    def end_if(self, grouping: str) -> None:
        self.add("conditional", GroupingIdentifier=grouping, WFControlFlowMode=2)

    def stop_if(self, value: Value, condition: int) -> None:
        grouping = self.if_(value, condition)
        self.actions.append(act("exit"))
        self.otherwise(grouping)
        self.end_if(grouping)

    def notify(self, title: str, *body: str | Value) -> None:
        self.actions.append(
            act(
                "notification",
                WFNotificationActionTitle=text(title),
                WFNotificationActionBody=text(*body),
                WFNotificationActionSound=True,
            )
        )


def actions(patterns: dict[str, Any], stations: dict[str, str], settings: dict[str, str]) -> Any:
    b = Builder(patterns)
    # Block 1: Stations
    stations_id = b.add("dictionary", WFItems=fields([(k, text(v)) for k, v in stations.items()]))
    # Block 2: the alert text (the Use Model step, if you add it, goes here)
    b.set_variable("AlertText", SHORTCUT_INPUT)
    # Block 3: is it about a delay?
    b.stop_if(output(b.match("signal"), "Matches"), HAS_NO_VALUE)
    # Block 4: too short to claim?
    b.stop_if(output(b.match("short_delay"), "Matches"), HAS_ANY_VALUE)
    # Block 5: departure time
    departure = b.group(b.match("departure"), 1)
    fixed = b.add(
        "text.replace",
        WFInput=text(output(departure, "Group")),
        WFReplaceTextFind=".",
        WFReplaceTextReplace=":",
    )
    b.set_variable("Departure", output(fixed, "Updated Text"))
    # Block 6: stations to CRS codes
    pair = b.match("stations")
    b.set_variable("From", output(b.group(pair, 1), "Group"))
    b.set_variable("To", output(b.group(pair, 2), "Group"))
    for name, crs in (("From", "OriginCRS"), ("To", "DestCRS")):
        found = b.add(
            "getvalueforkey",
            WFInput=attachment(output(stations_id, "Dictionary")),
            WFGetDictionaryValueType="Value",
            WFDictionaryKey=text(variable(name)),
        )
        b.set_variable(crs, output(found, "Dictionary Value"))
    # Block 7: travel date
    today = b.add(
        "format.date",
        WFDate=text(CURRENT_DATE),
        WFDateFormatStyle="Custom",
        WFDateFormat="yyyy-MM-dd",
        WFTimeFormatStyle="None",
    )
    b.set_variable("TravelDate", output(today, "Formatted Date"))
    written = b.match("date")
    grouping = b.if_(output(written, "Matches"), HAS_ANY_VALUE)
    day = b.group(written, 1)
    formatted = b.add(
        "format.date",
        WFDate=text(output(day, "Group")),
        WFDateFormatStyle="Custom",
        WFDateFormat="yyyy-MM-dd",
        WFTimeFormatStyle="None",
    )
    b.set_variable("TravelDate", output(formatted, "Formatted Date"))
    b.otherwise(grouping)
    b.end_if(grouping)
    # Block 8: check before anything leaves the phone
    summary = b.add(
        "gettext",
        WFTextActionText=text(
            variable("OriginCRS"),
            " ",
            variable("DestCRS"),
            " ",
            variable("Departure"),
            " ",
            variable("TravelDate"),
        ),
    )
    checked = b.add(
        "text.match",
        WFMatchTextPattern=patterns["check"]["regex"],
        WFMatchTextCaseSensitive=True,
        text=text(output(summary, "Text")),
    )
    grouping = b.if_(output(checked, "Matches"), HAS_NO_VALUE)
    b.notify(
        "Tempo Delay Spotter",
        "Spotted a delay but couldn't read the journey (",
        variable("Departure"),
        " ",
        variable("From"),
        " to ",
        variable("To"),
        "). Add missing stations to Stations. Nothing was sent.",
    )
    b.actions.append(act("exit"))
    b.otherwise(grouping)
    b.end_if(grouping)
    # Block 9: start a Clawback mission
    sent = b.add(
        "downloadurl",
        WFURL=settings["url"],
        WFHTTPMethod="POST",
        ShowHeaders=True,
        WFHTTPHeaders=fields([("Authorization", text(f"Bearer {settings['token']}"))]),
        WFHTTPBodyType="JSON",
        WFJSONValues=fields(
            [
                ("user_id", text(settings["user_id"])),
                ("display_name", text(settings["display_name"])),
                ("phone", text(settings["phone"])),
                ("origin_crs", text(variable("OriginCRS"))),
                ("destination_crs", text(variable("DestCRS"))),
                ("travel_date", text(variable("TravelDate"))),
                ("departure", text(variable("Departure"))),
                ("fare_gbp", text(settings["fare_gbp"])),
                ("time_value_gbp_h", text(settings["time_value_gbp_h"])),
            ]
        ),
    )
    # Block 10: tell me
    message = b.add(
        "getvalueforkey",
        WFInput=attachment(output(sent, "Contents of URL")),
        WFGetDictionaryValueType="Value",
        WFDictionaryKey=text("message"),
    )
    grouping = b.if_(output(message, "Dictionary Value"), HAS_ANY_VALUE)
    b.notify("Tempo", output(message, "Dictionary Value"))
    b.otherwise(grouping)
    b.notify("Tempo couldn't start a claim", output(sent, "Contents of URL"))
    b.end_if(grouping)
    return b.actions


def workflow(settings: dict[str, str]) -> Value:
    patterns = yaml.safe_load((FIXTURES / "patterns.yaml").read_text())
    stations = {
        str(k): str(v) for k, v in yaml.safe_load((FIXTURES / "stations.yaml").read_text()).items()
    }
    return {
        "WFWorkflowClientVersion": "2700.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 463140863,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowNoInputBehavior": {
            "Name": "WFWorkflowNoInputBehaviorGetClipboard",
            "Parameters": {},
        },
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions(patterns, stations, settings),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Tempo Delay Spotter shortcut file.")
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
        unsigned = Path(tmp) / "Tempo Delay Spotter.shortcut"
        unsigned.write_bytes(plist)
        sign = ["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned)]
        for _ in range(3):  # Apple's signing service sometimes answers HTTP 500 once
            done = subprocess.run([*sign, "--output", str(args.output)], check=False)  # noqa: S603
            if done.returncode == 0:
                print(f"wrote {args.output} (signed for anyone: AirDrop it to an iPhone)")
                return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
