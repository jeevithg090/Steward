#!/usr/bin/env python3
"""Build the "Ask Kairos" Siri Shortcut: "Hey Siri, Ask Kairos" -> listen -> Mac (local model + agents) -> speak the answer.

    python3 make_siri_shortcut.py      # writes phone/Ask Kairos.shortcut (signed, chmod 600; contains the phone key)

Actions: Dictate Text -> Speak "On it" -> POST https://<tunnel>/voice/phone-task {task, device: "team", wait: 50}
with header X-Tempo-Phone-Key -> Get Dictionary Value "answer" -> Speak Text.
The Conductor (hands/conductor.py) picks hub / laptop / phone agents for each part of the request.
Siri's own dictation and voice are used, so this path does not go through ElevenLabs.
The file holds the phone key: share it with nobody. If it leaks, run token_server.py --new-phone-key and rebuild.
"""
import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parent / "voice" / ".env"
URL = "https://unreleasing-laree-nebulously.ngrok-free.dev/voice/phone-task"
OUT = HERE / "Ask Kairos.shortcut"


def text(s):
    return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}


def var_text(output_name, output_uuid):
    return {"Value": {"string": "￼", "attachmentsByRange": {
        "{0, 1}": {"OutputName": output_name, "OutputUUID": output_uuid, "Type": "ActionOutput"}}},
        "WFSerializationType": "WFTextTokenString"}


def field(key, value, item_type=0):
    return {"WFItemType": item_type, "WFKey": text(key), "WFValue": value}


def build(phone_key: str) -> dict:
    dictate, fetch, value = (str(uuid.uuid4()).upper() for _ in range(3))
    actions = [
        {"WFWorkflowActionIdentifier": "is.workflow.actions.dictatetext",
         "WFWorkflowActionParameters": {"UUID": dictate, "WFDictateTextStopListening": "After Pause"}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.speaktext",
         "WFWorkflowActionParameters": {"WFText": text("On it."), "WFSpeakTextWait": True}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
         "WFWorkflowActionParameters": {
             "UUID": fetch, "WFURL": URL, "WFHTTPMethod": "POST", "WFHTTPBodyType": "JSON", "ShowHeaders": True,
             "WFHTTPHeaders": {"Value": {"WFDictionaryFieldValueItems": [field("X-Tempo-Phone-Key", text(phone_key))]},
                               "WFSerializationType": "WFDictionaryFieldValue"},
             "WFJSONValues": {"Value": {"WFDictionaryFieldValueItems": [
                 field("task", var_text("Dictated Text", dictate)),
                 field("device", text("team")),
                 field("wait", text("50"), item_type=3)]},
                 "WFSerializationType": "WFDictionaryFieldValue"}}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
         "WFWorkflowActionParameters": {"UUID": value, "WFGetDictionaryValueType": "Value", "WFDictionaryKey": "answer",
                                        "WFInput": {"Value": {"OutputName": "Contents of URL", "OutputUUID": fetch,
                                                              "Type": "ActionOutput"},
                                                    "WFSerializationType": "WFTextTokenAttachment"}}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.speaktext",
         "WFWorkflowActionParameters": {"WFText": var_text("Dictionary Value", value)}},
    ]
    return {"WFWorkflowClientVersion": "2607.0.1", "WFWorkflowMinimumClientVersion": 900,
            "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
            "WFWorkflowImportQuestions": [], "WFWorkflowTypes": [], "WFWorkflowHasShortcutInputVariables": False,
            "WFWorkflowInputContentItemClasses": ["WFStringContentItem"], "WFWorkflowActions": actions}


def main() -> int:
    key = next((l.split("=", 1)[1].strip() for l in ENV.read_text().splitlines() if l.startswith("TEMPO_PHONE_KEY=")), "")
    if not key:
        print("No TEMPO_PHONE_KEY in voice/.env")
        return 1
    unsigned = HERE / ".Tempo.unsigned.shortcut"
    unsigned.write_bytes(plistlib.dumps(build(key), fmt=plistlib.FMT_BINARY))
    unsigned.chmod(0o600)
    r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(OUT)],
                       capture_output=True, text=True)
    unsigned.unlink(missing_ok=True)
    if r.returncode != 0 or not OUT.exists():
        print("Signing failed:", (r.stderr or r.stdout).strip()[:300])
        return 1
    OUT.chmod(0o600)
    print(f"Signed shortcut written to {OUT} (contains the phone key; keep it private).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
