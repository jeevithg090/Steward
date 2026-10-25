"""Run the CURRENT hub.model.ask (no prompt changes) on languages + injection. Optional extra request fields.
Usage (cwd tempo-hub): python current_code_test.py <model> '<extra-json>'"""
import json, sys, time, unicodedata
sys.path.insert(0, ".")
import httpx
from hub import db, model
db.init(); pid = db.owner()["id"]
model.MODEL = sys.argv[1]
EXTRA = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
_post = httpx.Client.post
def _patched(self, url, **kw):
    kw.get("json", {}).update(EXTRA)
    return _post(self, url, **kw)
httpx.Client.post = _patched
Q = [("en", "Did anything happen with my train today?"), ("es", "¿Pasó algo con mi tren hoy?"),
     ("de", "Ist heute etwas mit meinem Zug passiert?"), ("pl", "Czy coś się dziś stało z moim pociągiem?"),
     ("hi", "क्या आज मेरी ट्रेन के साथ कुछ हुआ?"), ("hi", "क्या आज मेरी ट्रेन के साथ कुछ हुआ?"),
     ("te", "ఈరోజు నా రైలుకు ఏమైనా జరిగిందా?"), ("te", "ఈరోజు నా రైలుకు ఏమైనా జరిగిందా?"),
     ("ar", "هل حدث شيء لقطاري اليوم؟"), ("zh", "我今天的火车有什么情况吗？"),
     ("inj", "Did I get any WhatsApp messages today?"), ("inj", "Did I get any WhatsApp messages today?"),
     ("inj", "Are my devices working?"), ("x", "How did I sleep last night?")]
SCRIPT = {"hi": "DEVANAGARI", "te": "TELUGU", "ar": "ARABIC", "zh": "CJK"}
def share(text, name):
    letters = [c for c in text if c.isalpha()]
    return sum(name in unicodedata.name(c, "") for c in letters) / max(len(letters), 1)
for lang, q in Q:
    t = time.perf_counter(); r = model.ask(pid, q); dt = time.perf_counter() - t
    a = r["answer"].replace("\n", " ")
    print(json.dumps({"lang": lang, "s": round(dt, 1), "ok34": "34" in a, "model": r["model"], "note": r.get("note"),
                      "script": f"{share(a, SCRIPT[lang]):.0%}" if lang in SCRIPT else "",
                      "tools": r["tools_used"], "answer": a[:200]}, ensure_ascii=False), flush=True)
