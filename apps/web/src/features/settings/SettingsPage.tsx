// Settings (plan.md §2): the Gateway, the showcase switch, accessibility, language, and the
// teammate's model and voice keys with an honest label about what they change.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Check, Eye, Key, Lock, Pencil, Server, ShieldAlert, ShieldCheck, Sparkles, Type, Languages } from "lucide-react";
import { Badge, Button, Card, FOCUS, PageTitle, SectionTitle, Switch, toast } from "@/components/ui";
import { TEXT_SIZES, getPrefs, setPrefs, subscribe, type TextSize } from "@/lib/a11y-prefs";
import type { Health } from "@/lib/api";
import { LANGUAGES, type Language } from "@/lib/shield";
import type { ApiKeyProvider, ApiKeys, ModelOption, ModelProvider } from "@/types/types";

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "local",
    name: "Local model (Ollama)",
    description: "Runs on this machine. Nothing leaves it. Free and private.",
    requiresApiKey: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google's multimodal model; the Gateway uses it to read photos when it has a key.",
    requiresApiKey: false,
  },
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic's model for reasoning.",
    requiresApiKey: true,
  },
  {
    id: "openai",
    name: "GPT",
    description: "OpenAI's multimodal model.",
    requiresApiKey: true,
  },
];

const TAP = "min-h-[44px]";
const FIELD = `mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 disabled:opacity-50 ${FOCUS}`;

const PROVIDER_LABELS: Record<ApiKeyProvider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

export const REDUCE_MOTION_KEY = "tempo.reduceMotion";
export const LANGUAGE_KEY = "tempo.language";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function readLanguage(): Language {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return (LANGUAGES.find((l) => l.code === v)?.code ?? "en") as Language;
  } catch {
    return "en";
  }
}

interface SettingsPageProps {
  gatewayUrl: string;
  token: string;
  showcase: boolean;
  showcaseForced: boolean;
  onSaveGateway: (url: string, token: string) => void;
  onToggleShowcase: (on: boolean) => void;
  health: Health | null;
  ttsConfigured: boolean | null;
  language: Language;
  onLanguage: (language: Language) => void;
  activeModels: ModelProvider[];
  onToggleActiveModel: (model: ModelProvider, active: boolean) => void;
  apiKeys: ApiKeys;
  onUpdateApiKey: (provider: ApiKeyProvider, key: string) => void;
}

export function SettingsPage({
  gatewayUrl, token, showcase, showcaseForced, onSaveGateway, onToggleShowcase, health, ttsConfigured,
  language, onLanguage, activeModels, onToggleActiveModel, apiKeys, onUpdateApiKey,
}: SettingsPageProps) {
  const [url, setUrl] = useState(gatewayUrl);
  const [tok, setTok] = useState(token);
  const [saved, setSaved] = useState(false);
  const sizeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [reduceMotion, setReduceMotion] = useState(() => readFlag(REDUCE_MOTION_KEY));

  const [editingProvider, setEditingProvider] = useState<ApiKeyProvider | null>(null);
  const [tempKeyInput, setTempKeyInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => subscribe(() => setPrefsState(getPrefs())), []);
  useEffect(() => {
    setUrl(gatewayUrl);
    setTok(token);
  }, [gatewayUrl, token]);

  const toggleReduceMotion = (on: boolean) => {
    setReduceMotion(on);
    try {
      localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (on) document.documentElement.setAttribute("data-reduce-motion", "");
    else document.documentElement.removeAttribute("data-reduce-motion");
    toast.success(on ? "Motion reduced: nothing pulses or slides." : "Motion back on.");
  };

  const toggleShowcase = (on: boolean) => {
    onToggleShowcase(on);
    if (on) toast.success("Showcase on: every page now answers from recorded replies, with no Gateway.");
    else toast.success(`Showcase off: Tempo talks to the Gateway at ${gatewayUrl}.`);
  };

  const chooseSize = (id: TextSize, words: string) => {
    setPrefs({ textSize: id });
    toast.success(`Text size: ${words.toLowerCase()}.`);
  };

  // The text-size choices are one radio group: arrow keys move and choose, as the pattern expects.
  const onSizeKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + TEXT_SIZES.length) % TEXT_SIZES.length;
    const size = TEXT_SIZES[next]!;
    chooseSize(size.id as TextSize, size.words);
    sizeRefs.current[next]?.focus();
  };

  const openKey = (provider: ApiKeyProvider, current: string) => {
    opener.current = document.activeElement as HTMLElement | null;
    setEditingProvider(provider);
    setTempKeyInput(current);
  };

  const closeKey = () => {
    setEditingProvider(null);
    setTempKeyInput("");
    opener.current?.focus();
  };

  const elevenLabsKey = apiKeys.elevenlabs;
  const hasElevenLabsKey = Boolean(elevenLabsKey && elevenLabsKey.trim().length > 0);

  const handleToggle = (model: ModelOption, enable: boolean) => {
    setErrorMsg(null);
    if (enable && model.requiresApiKey) {
      const provider = model.id as ApiKeyProvider;
      const key = apiKeys[provider];
      if (!key || key.trim().length === 0) {
        setErrorMsg(`A key is needed to turn on ${model.name}. Add one below.`);
        openKey(provider, "");
        return;
      }
    }
    onToggleActiveModel(model.id, enable);
    toast.success(enable ? `${model.name} is on. It labels the reply; it never sets an amount.` : `${model.name} is off.`);
  };

  const handleSaveKey = (provider: ApiKeyProvider) => {
    const key = tempKeyInput.trim();
    onUpdateApiKey(provider, key);
    if (provider !== "elevenlabs" && key.length > 0) {
      onToggleActiveModel(provider, true);
      setErrorMsg(null);
    }
    toast.success(key ? `${PROVIDER_LABELS[provider]} key saved on this device only.` : `${PROVIDER_LABELS[provider]} key removed from this device.`);
    closeKey();
  };

  const isVoiceEdit = editingProvider === "elevenlabs";
  const chatLlm = (health as (Health & { chat?: { llm?: string } }) | null)?.chat?.llm;

  return (
    <div className="space-y-6 pb-8">
      <PageTitle lede="Where Tempo runs, how it speaks with you, and what is real in this run.">Settings</PageTitle>

      {/* Gateway */}
      <Card as="section" aria-labelledby="gateway-heading">
        <SectionTitle id="gateway-heading" right={health ? <Badge tone={health.mode === "replay" ? "amber" : "emerald"}>{health.mode} · {health.deploy}</Badge> : <Badge tone="rose">not reachable</Badge>}>
          <span className="inline-flex items-center gap-1.5"><Server size={12} aria-hidden /> Gateway</span>
        </SectionTitle>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const target = url.trim();
            if (target && !/^https?:\/\//i.test(target)) {
              toast.error("The Gateway address should start with http:// or https://, for example http://127.0.0.1:8000.");
              return;
            }
            onSaveGateway(target, tok.trim());
            setSaved(true);
            toast.success(`Gateway saved and reconnected: ${target || "the build's default address"}. The badge at the top shows whether it answers.`);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          <label className="text-xs text-slate-300">
            URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={showcase} inputMode="url" autoComplete="off" className={FIELD} placeholder="http://127.0.0.1:8000" />
          </label>
          <label className="text-xs text-slate-300">
            Bearer token (demo only)
            <input type="password" value={tok} onChange={(e) => setTok(e.target.value)} disabled={showcase} autoComplete="off" className={FIELD} />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={showcase} icon={saved ? <Check size={14} aria-hidden /> : undefined} className={TAP}>{saved ? "Saved" : "Save and reconnect"}</Button>
          </div>
        </form>
        {showcase && <p className="mt-2 text-xs text-slate-400">Switch the showcase off to change the Gateway.</p>}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/5 pt-3">
          <div>
            <p className="text-sm text-slate-100">Showcase mode</p>
            <p className="text-xs text-slate-400">
              {showcaseForced
                ? "This build runs on recorded replies only; there is no Gateway to switch to."
                : "No Gateway: every page answers from replies recorded from a real replay-mode run."}
            </p>
          </div>
          <Switch checked={showcase} disabled={showcaseForced} onChange={toggleShowcase} label="Showcase mode" />
        </div>
        {health && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
            <dt>Simulated</dt><dd className="text-slate-200">{health.simulated.join(", ") || "nothing"}</dd>
            <dt>Region</dt><dd className="text-slate-200">{health.region}</dd>
            <dt>Outside AI</dt><dd className="text-slate-200">{health.third_parties.join(", ") || "none"}</dd>
            <dt>Small talk</dt><dd className="text-slate-200">{chatLlm ?? "canned"}</dd>
          </dl>
        )}
      </Card>

      {/* Accessibility */}
      <Card as="section" aria-labelledby="a11y-heading">
        <SectionTitle id="a11y-heading"><span className="inline-flex items-center gap-1.5"><Eye size={12} aria-hidden /> Reading and seeing</span></SectionTitle>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <span id="text-size-label" className="inline-flex items-center gap-1 text-sm text-slate-200"><Type size={14} aria-hidden /> Text size</span>
            <div role="radiogroup" aria-labelledby="text-size-label" className="flex items-center gap-2">
              {TEXT_SIZES.map((size, i) => {
                const on = prefs.textSize === size.id;
                return (
                  <button
                    key={size.id}
                    ref={(el) => {
                      sizeRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={size.words}
                    tabIndex={on ? 0 : -1}
                    onClick={() => chooseSize(size.id as TextSize, size.words)}
                    onKeyDown={(e) => onSizeKey(e, i)}
                    className={`${TAP} min-w-[44px] rounded-full px-3 text-sm font-semibold ${FOCUS} ${on ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-200 hover:bg-white/10"}`}
                  >
                    {size.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-slate-200">
            <Switch
              checked={prefs.plain}
              onChange={(on) => {
                setPrefs({ plain: on });
                toast.success(on ? "Plain mode on: bigger targets, fewer extras." : "Plain mode off.");
              }}
              label="Plain mode"
            />
            Plain mode <span className="text-xs text-slate-400">(bigger targets, fewer extras)</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-slate-200">
            <Switch checked={reduceMotion} onChange={toggleReduceMotion} label="Reduce motion" />
            Reduce motion
          </label>
        </div>
      </Card>

      {/* Language */}
      <Card as="section" aria-labelledby="language-heading">
        <SectionTitle id="language-heading"><span className="inline-flex items-center gap-1.5"><Languages size={12} aria-hidden /> Language Tempo speaks to you</span></SectionTitle>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              aria-pressed={language === l.code}
              onClick={() => {
                onLanguage(l.code);
                if (language !== l.code) toast.success(`Scam warnings will be spoken in ${l.name}.`);
              }}
              lang={l.bcp47}
              className={`${TAP} rounded-full px-4 text-sm ${FOCUS} ${language === l.code ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-200 hover:bg-white/10"}`}
            >
              {l.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">Scam warnings are spoken in this language; the chat's own replies are English tonight. Translations are machine-written and not yet checked.</p>
      </Card>

      {/* Voice */}
      <Card as="section" aria-labelledby="voice-heading" tone={ttsConfigured || hasElevenLabsKey ? "indigo" : "default"}>
        <SectionTitle id="voice-heading" right={ttsConfigured ? <Badge tone="emerald">Gateway voice on</Badge> : ttsConfigured === false ? <Badge tone="slate">browser voice</Badge> : null}>
          <span className="inline-flex items-center gap-1.5"><AudioLines size={12} aria-hidden /> Voice</span>
        </SectionTitle>
        <p className="text-xs text-slate-400">
          Replies are read aloud by the Gateway's ElevenLabs voice when it has a key (the key never reaches this browser). Without one, the browser's own voice speaks and the face still moves. A key pasted here is a third path, for the desktop app, kept on this device.
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
            <Key size={14} className="text-slate-500" aria-hidden />
            <span>{hasElevenLabsKey ? `ElevenLabs key: ••••••••${elevenLabsKey?.slice(-4)}` : "ElevenLabs key: not set (optional)"}</span>
          </div>
          <Button variant="quiet" icon={<Pencil size={12} aria-hidden />} onClick={() => openKey("elevenlabs", elevenLabsKey || "")} className={TAP} aria-label={hasElevenLabsKey ? "Edit the ElevenLabs key" : "Add an ElevenLabs key"}>
            {hasElevenLabsKey ? "Edit key" : "Add key"}
          </Button>
        </div>
      </Card>

      {/* Models */}
      <section aria-labelledby="models-heading" className="space-y-3">
        <div>
          <h2 id="models-heading" className="text-sm font-semibold text-slate-100">Model providers</h2>
          <p className="mt-1 text-xs text-slate-400">
            Honest label: this picker names the reply. The Gateway's deployment mode ({health?.deploy ?? "unknown"}) decides which models sit on the Consensus Court, and <strong className="text-slate-200">no model ever sets an amount</strong>: the Rights Engine's rules do.
          </p>
        </div>
        {errorMsg && (
          <div role="alert" className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <ShieldAlert className="shrink-0 text-amber-400" size={18} aria-hidden />
            <p>{errorMsg}</p>
          </div>
        )}
        {AVAILABLE_MODELS.map((model) => {
          const isActive = activeModels.includes(model.id);
          const isPrimaryLocal = model.id === "local";
          const providerKey = model.requiresApiKey ? apiKeys[model.id as ApiKeyProvider] : null;
          const hasKey = !model.requiresApiKey || Boolean(providerKey && providerKey.trim().length > 0);
          return (
            <Card key={model.id} tone={isPrimaryLocal ? "emerald" : isActive ? "indigo" : "default"}>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-100">{model.name}</span>
                    {isPrimaryLocal && <Badge tone="emerald"><ShieldCheck size={12} aria-hidden /> Private</Badge>}
                    {isActive && !isPrimaryLocal && <Badge tone="indigo"><Sparkles size={12} aria-hidden /> On</Badge>}
                  </div>
                  <p className="text-xs text-slate-400">{model.description}</p>
                </div>
                <Switch checked={isActive} disabled={!hasKey && !isActive} onChange={(checked) => handleToggle(model, checked)} label={`Enable ${model.name}`} />
              </div>
              {model.requiresApiKey && (
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                    <Key size={14} className="text-slate-500" aria-hidden />
                    <span>{hasKey ? `Key: ••••••••${providerKey?.slice(-4)}` : "Key: not set"}</span>
                  </div>
                  <Button variant="quiet" icon={<Pencil size={12} aria-hidden />} onClick={() => { const provider = model.id as ApiKeyProvider; openKey(provider, apiKeys[provider] || ""); }} className={TAP} aria-label={`${hasKey ? "Edit the" : "Add a"} ${model.name} key`}>
                    {hasKey ? "Edit key" : "Add key"}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </section>

      {editingProvider && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="key-dialog-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeKey();
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-nexus-card p-6 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-slate-100">
              <Lock size={18} className="text-indigo-400" aria-hidden />
              <h2 id="key-dialog-heading" className="font-semibold">Set the {PROVIDER_LABELS[editingProvider]} key</h2>
            </div>
            <p className="mb-4 text-xs text-slate-400">
              Kept in this browser only. {isVoiceEdit && "Leave it empty and save to remove the key."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveKey(editingProvider);
              }}
            >
              <input
                type="password"
                aria-label={`${PROVIDER_LABELS[editingProvider]} key`}
                placeholder={`${PROVIDER_LABELS[editingProvider]} key`}
                value={tempKeyInput}
                onChange={(e) => setTempKeyInput(e.target.value)}
                autoComplete="off"
                className={FIELD}
                autoFocus
              />
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="quiet" onClick={closeKey} className={TAP}>Cancel</Button>
                <Button type="submit" icon={<Check size={14} aria-hidden />} className={TAP}>{isVoiceEdit ? "Save" : "Save and turn on"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
