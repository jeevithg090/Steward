// Scam Shield on the web (docs/scam-shield.md §5.3): the Gateway's /scam routes, a recorded
// showcase that answers from fixtures taken off a real replay-mode Gateway, and the browser's own
// voice for reading the verdict aloud. lib/api.ts is left as it is (SHIPPING.md collision rules).
import { gatewayConfig } from "./api";
import { GatewayError } from "./catalog-client";
import hmrcJson from "@/showcase/shield-hmrc.json";
import greyJson from "@/showcase/shield-grey.json";
import genuineJson from "@/showcase/shield-genuine.json";
import loanJson from "@/showcase/shield-loan.json";
import statusJson from "@/showcase/shield-status.json";

export type Level = "likely_scam" | "caution" | "unknown" | "no_flags";
export type Zone = "warn" | "sandbox" | "quiet";
export type Language = "en" | "hi" | "pa" | "pl" | "ur" | "cy";

export interface LinkVerdict {
  url: string;
  host: string;
  findings: string[];
  words: string[];
}

/** POST /scam/check: the verdict, its reasons, and the exact words the voice says. */
export interface ShieldVerdict {
  alert_id: string;
  level: Level;
  zone: Zone;
  confidence: number | null;
  reasons: string[];
  why: string[];
  advice: string;
  say: string;
  held: boolean;
  language: string;
  links: LinkVerdict[];
  rules: string[];
  top_words: string[];
  model: { version: string } | null;
  simulated: boolean;
}

export interface ShieldAlert {
  id: string;
  at: string;
  user_id: string | null;
  source: string;
  zone: Zone;
  level: Level;
  confidence: number | null;
  rules: string[];
  link_hosts: string[];
  checked: boolean;
  label: string | null;
}

/** GET /scam/shield: counts and recent alerts, never a message. */
export interface ShieldStatus {
  today: { checked: number; held: number; warned: number };
  recent: ShieldAlert[];
  model: { version: string; metrics: Record<string, number> } | null;
  feeds: Record<string, { entries: number; fetched_at: string | null }>;
  simulated: { registers: boolean; sandbox: boolean };
}

export interface ShieldSource {
  readonly showcase: boolean;
  check(text: string, language: Language, userId?: string): Promise<ShieldVerdict>;
  status(userId?: string): Promise<ShieldStatus>;
  feedback(alertId: string, label: "scam" | "real"): Promise<void>;
}

export const LANGUAGES: { code: Language; name: string; bcp47: string; rtl?: boolean }[] = [
  { code: "en", name: "English", bcp47: "en-GB" },
  { code: "hi", name: "हिन्दी (Hindi)", bcp47: "hi-IN" },
  { code: "pa", name: "ਪੰਜਾਬੀ (Punjabi)", bcp47: "pa-IN" },
  { code: "pl", name: "Polski (Polish)", bcp47: "pl-PL" },
  { code: "ur", name: "اردو (Urdu)", bcp47: "ur-PK", rtl: true },
  { code: "cy", name: "Cymraeg (Welsh)", bcp47: "cy-GB" },
];

/** Three messages to try, made up; the first is the demo's. */
export const SAMPLES = [
  {
    id: "hmrc",
    label: "A tax refund text",
    text: "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at http://hmrc-refunds-gov.uk/claim",
  },
  { id: "grey", label: "A short link from a stranger", text: "Here is the link you asked for: rb.gy/4k2q" },
  {
    id: "genuine",
    label: "A bank's genuine code",
    text: "Your HSBC one-time passcode is 482913. Never share this code with anyone. Call 159.",
  },
  {
    id: "loan",
    label: "An instant loan offer",
    text: "Congratulations! Instant loan of Rs 50,000 approved, no documents, no CIBIL. Pay processing fee 499 to get disbursal. Download the app: http://quick-rupee-loan.top/app.apk",
  },
] as const;

export const LEVEL_WORDS: Record<Level, string> = {
  likely_scam: "This looks like a scam",
  caution: "Take care with this one",
  unknown: "Tempo could not check this",
  no_flags: "No warning signs found",
};

export const ZONE_WORDS: Record<Zone, string> = {
  warn: "Tempo would say this out loud, straight away.",
  sandbox: "Tempo would hold this, look behind its link, then speak.",
  quiet: "Tempo would stay quiet unless asked.",
};

export const RULE_WORDS: Record<string, string> = {
  scam_safe_account: "talks about a safe account",
  scam_code_request: "asks for a code, PIN or password",
  scam_urgency: "pushes you to act now",
  scam_account_threat: "says your account is locked or at risk",
  scam_short_link: "has a shortened or look-alike link",
  scam_official_pretext: "pretends to be a refund, a parcel fee or a fraud team",
  scam_loan_app: "offers an instant loan with a fee up front",
  scam_family_emergency: "says a relative on a new number needs money",
};

async function detail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return fallback;
}

/** The live Gateway, with the same bearer as the rest of the site. */
export class ShieldClient implements ShieldSource {
  readonly showcase = false;
  constructor(
    private readonly config = gatewayConfig(),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.config.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) throw new GatewayError(response.status, await detail(response, `${path}: HTTP ${response.status}`));
    return (await response.json()) as T;
  }

  check(text: string, language: Language, userId?: string): Promise<ShieldVerdict> {
    return this.call<ShieldVerdict>("/scam/check", {
      method: "POST",
      body: JSON.stringify({ text, language, ...(userId ? { user_id: userId } : {}) }),
    });
  }

  status(userId?: string): Promise<ShieldStatus> {
    const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    return this.call<ShieldStatus>(`/scam/shield${query}`);
  }

  async feedback(alertId: string, label: "scam" | "real"): Promise<void> {
    await this.call("/scam/feedback", { method: "POST", body: JSON.stringify({ alert_id: alertId, label }) });
  }
}

const RECORDED: Record<string, ShieldVerdict> = {
  hmrc: hmrcJson as ShieldVerdict,
  grey: greyJson as ShieldVerdict,
  genuine: genuineJson as ShieldVerdict,
  loan: loanJson as ShieldVerdict,
};

/**
 * Showcase (no Gateway): the four sample messages answer with responses recorded from a real
 * replay-mode Gateway (scripts/record_shield_showcase.py). Any other text gets an honest refusal,
 * because nothing here invents a verdict.
 */
export class ShowcaseShield implements ShieldSource {
  readonly showcase = true;
  private recent: ShieldAlert[] = structuredClone((statusJson as ShieldStatus).recent);

  async check(text: string, language: Language): Promise<ShieldVerdict> {
    const sample = SAMPLES.find((s) => s.text === text.trim());
    if (!sample) {
      throw new GatewayError(
        0,
        "There is no Gateway in the showcase, so only the sample messages can be checked. Run Tempo locally to check your own.",
      );
    }
    const recorded = structuredClone(RECORDED[sample.id]!);
    const alert: ShieldAlert = {
      id: recorded.alert_id,
      at: new Date().toISOString(),
      user_id: null,
      source: "web",
      zone: recorded.zone,
      level: recorded.level,
      confidence: recorded.confidence,
      rules: recorded.rules,
      link_hosts: recorded.links.map((l) => l.host),
      checked: recorded.held,
      label: null,
    };
    this.recent = [alert, ...this.recent].slice(0, 20);
    if (language !== "en") recorded.say = translatedSay(recorded, language);
    recorded.language = language;
    return recorded;
  }

  async status(): Promise<ShieldStatus> {
    const base = statusJson as ShieldStatus;
    const today = this.recent.filter((a) => a.at.startsWith(new Date().toISOString().slice(0, 10)));
    return {
      ...base,
      recent: this.recent,
      today: {
        checked: today.length,
        held: today.filter((a) => a.checked).length,
        warned: today.filter((a) => a.level === "likely_scam").length,
      },
    };
  }

  async feedback(alertId: string, label: "scam" | "real"): Promise<void> {
    this.recent = this.recent.map((a) => (a.id === alertId ? { ...a, label } : a));
  }
}

// voice/warnings.yaml, as the Gateway speaks them; only English carries the reasons.
const SPOKEN: Record<Exclude<Language, "en">, Record<"warn" | "hold" | "cleared" | "caution" | "unknown" | "ring", string>> = {
  hi: {
    warn: "उस मैसेज को मत छुएँ। यह आपका पैसा लेने की एक चाल है।",
    hold: "मैं उस मैसेज की जाँच कर रहा हूँ। अभी उसमें कुछ भी मत दबाएँ।",
    cleared: "मैंने उस मैसेज की जाँच की। मुझे खतरे का कोई संकेत नहीं मिला। इससे यह साबित नहीं होता कि वह असली है।",
    caution: "उस मैसेज से सावधान रहें। यह आपको जल्दी करने के लिए दबाव डाल रहा है। किसी भरोसेमंद व्यक्ति से पूछे बिना कुछ न करें।",
    unknown: "मैं उस मैसेज की जाँच नहीं कर सका। जब तक मैं जाँच न कर लूँ, उस पर कुछ न करें।",
    ring: "कंपनी को उस नंबर पर फ़ोन करें जो आप पहले से जानते हैं।",
  },
  pa: {
    warn: "ਉਸ ਮੈਸੇਜ ਨੂੰ ਹੱਥ ਨਾ ਲਾਓ। ਇਹ ਤੁਹਾਡੇ ਪੈਸੇ ਲੈਣ ਦੀ ਇੱਕ ਚਾਲ ਹੈ।",
    hold: "ਮੈਂ ਉਸ ਮੈਸੇਜ ਦੀ ਜਾਂਚ ਕਰ ਰਿਹਾ ਹਾਂ। ਹਾਲੇ ਉਸ ਵਿੱਚ ਕੁਝ ਨਾ ਦਬਾਓ।",
    cleared: "ਮੈਂ ਉਸ ਮੈਸੇਜ ਦੀ ਜਾਂਚ ਕੀਤੀ। ਮੈਨੂੰ ਖ਼ਤਰੇ ਦਾ ਕੋਈ ਨਿਸ਼ਾਨ ਨਹੀਂ ਮਿਲਿਆ। ਇਸ ਨਾਲ ਇਹ ਸਾਬਤ ਨਹੀਂ ਹੁੰਦਾ ਕਿ ਇਹ ਅਸਲੀ ਹੈ।",
    caution: "ਉਸ ਮੈਸੇਜ ਤੋਂ ਸਾਵਧਾਨ ਰਹੋ। ਇਹ ਤੁਹਾਨੂੰ ਜਲਦੀ ਕਰਨ ਲਈ ਦਬਾਅ ਪਾ ਰਿਹਾ ਹੈ। ਕਿਸੇ ਭਰੋਸੇਯੋਗ ਵਿਅਕਤੀ ਨੂੰ ਪੁੱਛੇ ਬਿਨਾਂ ਕੁਝ ਨਾ ਕਰੋ।",
    unknown: "ਮੈਂ ਉਸ ਮੈਸੇਜ ਦੀ ਜਾਂਚ ਨਹੀਂ ਕਰ ਸਕਿਆ। ਜਦ ਤੱਕ ਮੈਂ ਜਾਂਚ ਨਾ ਕਰ ਲਵਾਂ, ਉਸ ਉੱਤੇ ਕੁਝ ਨਾ ਕਰੋ।",
    ring: "ਕੰਪਨੀ ਨੂੰ ਉਸ ਨੰਬਰ ਉੱਤੇ ਫ਼ੋਨ ਕਰੋ ਜੋ ਤੁਸੀਂ ਪਹਿਲਾਂ ਤੋਂ ਜਾਣਦੇ ਹੋ।",
  },
  pl: {
    warn: "Nie dotykaj tej wiadomości. To podstęp, żeby zabrać Twoje pieniądze.",
    hold: "Sprawdzam tę wiadomość. Nie klikaj w niej niczego.",
    cleared: "Sprawdziłem tę wiadomość. Nie znalazłem sygnałów ostrzegawczych. To nie dowodzi, że jest prawdziwa.",
    caution: "Uważaj na tę wiadomość. Naciska, żebyś działał szybko. Nie rób nic, dopóki nie sprawdzisz z kimś, komu ufasz.",
    unknown: "Nie mogłem sprawdzić tej wiadomości. Nie reaguj na nią, dopóki tego nie zrobię.",
    ring: "Zadzwoń do firmy na numer, który już znasz.",
  },
  ur: {
    warn: "اس پیغام کو ہاتھ نہ لگائیں۔ یہ آپ کا پیسہ لینے کی ایک چال ہے۔",
    hold: "میں اس پیغام کی جانچ کر رہا ہوں۔ ابھی اس میں کچھ نہ دبائیں۔",
    cleared: "میں نے اس پیغام کی جانچ کی۔ مجھے خطرے کی کوئی نشانی نہیں ملی۔ اس سے یہ ثابت نہیں ہوتا کہ یہ اصلی ہے۔",
    caution: "اس پیغام سے محتاط رہیں۔ یہ آپ پر جلدی کرنے کا دباؤ ڈال رہا ہے۔ کسی بھروسے مند شخص سے پوچھے بغیر کچھ نہ کریں۔",
    unknown: "میں اس پیغام کی جانچ نہیں کر سکا۔ جب تک میں جانچ نہ کر لوں، اس پر کچھ نہ کریں۔",
    ring: "کمپنی کو اس نمبر پر فون کریں جو آپ پہلے سے جانتے ہیں۔",
  },
  cy: {
    warn: "Peidiwch â chyffwrdd â'r neges yna. Twyll ydy hi, i gymryd eich arian.",
    hold: "Rydw i'n gwirio'r neges yna. Peidiwch â thapio dim ynddi eto.",
    cleared: "Gwiriais y neges yna. Ni welais unrhyw arwyddion o berygl. Nid yw hynny'n profi ei bod yn ddilys.",
    caution: "Byddwch yn ofalus gyda'r neges yna. Mae'n eich gwthio i weithredu ar frys. Peidiwch â gwneud dim nes ichi holi rhywun rydych yn ei drystio.",
    unknown: "Ni allwn wirio'r neges yna. Peidiwch â gweithredu arni nes imi allu gwneud.",
    ring: "Ffoniwch y cwmni ar rif rydych chi'n ei wybod yn barod.",
  },
};

/** What the Gateway would say in another language for a recorded English verdict (showcase only). */
export function translatedSay(verdict: ShieldVerdict, language: Language): string {
  if (language === "en") return verdict.say;
  const lines = SPOKEN[language];
  if (verdict.level === "likely_scam") return `${lines.warn} ${lines.ring}`;
  if (verdict.zone === "sandbox") return lines.hold;
  if (verdict.level === "caution") return lines.caution;
  if (verdict.level === "unknown") return lines.unknown;
  return verdict.held ? lines.cleared : verdict.say;
}

/** The browser's own voice (Web Speech), the same shape as Read It To Me's speaker. */
export interface Voice {
  available: boolean;
  speak(text: string, language: Language): void;
  stop(): void;
}

export function browserVoice(): Voice {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  return {
    available: Boolean(synth),
    speak(text, language) {
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
      utterance.rate = 0.9;
      synth.speak(utterance);
    },
    stop() {
      synth?.cancel();
    },
  };
}
