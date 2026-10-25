"""Run hub.model.ask (the real tool loop) for one question in many languages, per model.
Usage: python lang_test.py <model> [--hint]   (run with cwd = tempo-hub; read-only use of the DB)"""
import json, sys, time, unicodedata
sys.path.insert(0, ".")
from hub import db, model
db.init()
pid = db.owner()["id"]
model.MODEL = sys.argv[1]
if "--hint" in sys.argv:
    model.SYSTEM += (" The event data is in English, so always call search_events with English keywords, even when the"
                     " question is in another language. Write your final answer in the same language as the question.")
Q = {
    "en": "Did anything happen with my train today?",
    "es": "¿Pasó algo con mi tren hoy?",
    "fr": "Est-ce qu'il s'est passé quelque chose avec mon train aujourd'hui ?",
    "de": "Ist heute etwas mit meinem Zug passiert?",
    "pl": "Czy coś się dziś stało z moim pociągiem?",
    "hi": "क्या आज मेरी ट्रेन के साथ कुछ हुआ?",
    "te": "ఈరోజు నా రైలుకు ఏమైనా జరిగిందా?",
    "ar": "هل حدث شيء لقطاري اليوم؟",
    "zh": "我今天的火车有什么情况吗？",
    "cy": "Ddigwyddodd rhywbeth gyda fy nhrên i heddiw?",
}
SCRIPT = {"hi": "DEVANAGARI", "te": "TELUGU", "ar": "ARABIC", "zh": "CJK"}
def share(text, name):
    letters = [c for c in text if c.isalpha()]
    return sum(name in unicodedata.name(c, "") for c in letters) / max(len(letters), 1)
for lang, q in Q.items():
    t = time.perf_counter(); r = model.ask(pid, q); dt = time.perf_counter() - t
    a = r["answer"].replace("\n", " ")
    correct = any(k in a for k in ("34", "३४", "٣٤", "౩౪"))
    script = f"{share(a, SCRIPT[lang]):.0%} {SCRIPT[lang].lower()}" if lang in SCRIPT else ""
    print(json.dumps({"m": model.MODEL, "lang": lang, "s": round(dt, 1), "ok34": correct, "model": r["model"],
                      "script": script, "tools": r["tools_used"], "answer": a[:220]}, ensure_ascii=False), flush=True)
