"""Languages the letter reader speaks. The model writes any language; this table gives each one a name for the
prompt, the BCP-47 tag the phone's own voice needs, and whether Gemini's voice is expected to cover it.
Unknown codes still work: they're passed to the model as given and the phone tries its best voice.
"""
from __future__ import annotations

LANGUAGES = {
    "en-GB": {"name": "English", "native": "English", "speech": "en-GB", "hint": "plain British English"},
    "en": {"name": "English", "native": "English", "speech": "en-GB", "hint": "plain British English"},
    "cy": {"name": "Welsh", "native": "Cymraeg", "speech": "cy-GB", "hint": "everyday spoken Welsh, formal 'chi'"},
    "te": {"name": "Telugu", "native": "తెలుగు", "speech": "te-IN", "hint": "everyday spoken Telugu, simple words, the way family talk at home"},
    "hi": {"name": "Hindi", "native": "हिन्दी", "speech": "hi-IN", "hint": "everyday spoken Hindi, simple words, Devanagari"},
    "ur": {"name": "Urdu", "native": "اردو", "speech": "ur-PK", "hint": "everyday spoken Urdu"},
    "pa": {"name": "Punjabi", "native": "ਪੰਜਾਬੀ", "speech": "pa-IN", "hint": "everyday spoken Punjabi, Gurmukhi"},
    "bn": {"name": "Bengali", "native": "বাংলা", "speech": "bn-IN", "hint": "everyday spoken Bengali"},
    "gu": {"name": "Gujarati", "native": "ગુજરાતી", "speech": "gu-IN", "hint": "everyday spoken Gujarati"},
    "ta": {"name": "Tamil", "native": "தமிழ்", "speech": "ta-IN", "hint": "everyday spoken Tamil"},
    "pl": {"name": "Polish", "native": "Polski", "speech": "pl-PL", "hint": "everyday spoken Polish"},
    "ro": {"name": "Romanian", "native": "Română", "speech": "ro-RO", "hint": "everyday spoken Romanian"},
    "ar": {"name": "Arabic", "native": "العربية", "speech": "ar-SA", "hint": "simple spoken Arabic, understood across dialects"},
    "zh": {"name": "Chinese (Mandarin)", "native": "中文", "speech": "zh-CN", "hint": "simple spoken Mandarin"},
    "es": {"name": "Spanish", "native": "Español", "speech": "es-ES", "hint": "everyday spoken Spanish"},
    "pt": {"name": "Portuguese", "native": "Português", "speech": "pt-PT", "hint": "everyday spoken Portuguese"},
    "fr": {"name": "French", "native": "Français", "speech": "fr-FR", "hint": "everyday spoken French"},
    "it": {"name": "Italian", "native": "Italiano", "speech": "it-IT", "hint": "everyday spoken Italian"},
    "tr": {"name": "Turkish", "native": "Türkçe", "speech": "tr-TR", "hint": "everyday spoken Turkish"},
    "so": {"name": "Somali", "native": "Soomaali", "speech": "so-SO", "hint": "everyday spoken Somali"},
    "ku": {"name": "Kurdish", "native": "Kurdî", "speech": "ku", "hint": "everyday spoken Kurdish (Kurmanji unless the dialect says Sorani)"},
    "fa": {"name": "Persian", "native": "فارسی", "speech": "fa-IR", "hint": "everyday spoken Persian"},
    "uk": {"name": "Ukrainian", "native": "Українська", "speech": "uk-UA", "hint": "everyday spoken Ukrainian"},
    "ru": {"name": "Russian", "native": "Русский", "speech": "ru-RU", "hint": "everyday spoken Russian"},
}

# Shown on the phone as choices (code, label in its own script). The field also takes any other code.
CHOICES = [("en-GB", "English"), ("cy", "Cymraeg"), ("te", "తెలుగు"), ("hi", "हिन्दी"), ("ur", "اردو"),
           ("pa", "ਪੰਜਾਬੀ"), ("bn", "বাংলা"), ("pl", "Polski"), ("ro", "Română"), ("ar", "العربية"), ("zh", "中文"),
           ("es", "Español"), ("pt", "Português")]


def info(code: str) -> dict:
    code = (code or "en-GB").strip()
    if code in LANGUAGES:
        return {"code": code, **LANGUAGES[code]}
    base = code.split("-")[0].lower()
    if base in LANGUAGES:
        return {"code": code, **LANGUAGES[base], "speech": code}
    return {"code": code, "name": code, "native": code, "speech": code, "hint": f"everyday spoken {code}"}
