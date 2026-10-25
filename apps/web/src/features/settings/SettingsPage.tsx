// Settings (plan.md §2): the Gateway, the showcase switch, accessibility, language, and the
// teammate's model and voice keys with an honest label about what they change.
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { AudioLines, Bot, BrainCircuit, Check, Eye, HardDrive, Info, Key, Languages, Lock, Pencil, Server, ShieldAlert, ShieldCheck, Sparkles, Type } from "lucide-react";
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
const FIELD = `mt-1.5 min-h-[44px] w-full rounded-2xl border border-white/10 bg-ink-900/70 px-3.5 py-2 font-mono text-[13px] font-normal normal-case tracking-normal text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-colors placeholder:text-slate-500 hover:border-white/20 focus:border-violet-400/60 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const FIELD_LABEL = "block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400";

const MODEL_ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = { local: HardDrive, gemini: Sparkles, claude: BrainCircuit, openai: Bot };

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
      <Card as="section" aria-labelledby="gateway-heading" className="motion-safe:animate-fade-up">
        <GroupHead icon={<Server size={18} strokeWidth={1.75} />} right={health ? <Badge tone={health.mode === "replay" ? "amber" : "emerald"} dot>{health.mode} · {health.deploy}</Badge> : <Badge tone="rose" dot>not reachable</Badge>}>
          <SectionTitle id="gateway-heading" className="!mb-0">
            Gateway
          </SectionTitle>
          <p className="mt-0.5 text-sm text-slate-400">The server that does the work. Every page talks to it.</p>
        </GroupHead>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1.3fr_1fr_auto]"
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
          <label className={FIELD_LABEL}>
            URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={showcase} inputMode="url" autoComplete="off" className={FIELD} placeholder="http://127.0.0.1:8000" />
          </label>
          <label className={FIELD_LABEL}>
            Bearer token (demo only)
            <input type="password" value={tok} onChange={(e) => setTok(e.target.value)} disabled={showcase} autoComplete="off" className={FIELD} />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={showcase} icon={saved ? <Check size={14} aria-hidden /> : undefined} className={`${TAP} w-full sm:w-auto`}>{saved ? "Saved" : "Save and reconnect"}</Button>
          </div>
        </form>
        {showcase && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-100">
            <Info size={14} aria-hidden className="shrink-0 text-amber-300" />
            Switch the showcase off to change the Gateway.
          </p>
        )}
        <Row
          title="Showcase mode"
          description={
            showcaseForced
              ? "This build runs on recorded replies only; there is no Gateway to switch to."
              : "No Gateway: every page answers from replies recorded from a real replay-mode run."
          }
          control={<Switch checked={showcase} disabled={showcaseForced} onChange={toggleShowcase} label="Showcase mode" />}
        />
        {health && (
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Simulated" value={health.simulated.join(", ") || "nothing"} />
            <Fact label="Region" value={health.region} />
            <Fact label="Outside AI" value={health.third_parties.join(", ") || "none"} />
            <Fact label="Small talk" value={chatLlm ?? "canned"} />
          </dl>
        )}
      </Card>

      {/* Accessibility */}
      <Card as="section" aria-labelledby="a11y-heading">
        <GroupHead icon={<Eye size={18} strokeWidth={1.75} />}>
          <SectionTitle id="a11y-heading" className="!mb-0">
            Reading and seeing
          </SectionTitle>
          <p className="mt-0.5 text-sm text-slate-400">Kept on this device, for every page.</p>
        </GroupHead>
        <div className="mt-2 divide-y divide-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
            <div className="min-w-0">
              <p id="text-size-label" className="flex items-center gap-2 text-[15px] font-medium text-white">
                <Type size={15} aria-hidden className="text-violet-300" /> Text size
              </p>
              <p className="mt-0.5 text-sm text-slate-400">Larger letters everywhere; the layout follows.</p>
            </div>
            <div role="radiogroup" aria-labelledby="text-size-label" className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
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
                    className={`${TAP} min-w-[52px] rounded-full px-3.5 font-semibold transition-colors duration-150 motion-reduce:transition-none ${FOCUS} ${
                      on ? "bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_8px_20px_-10px_rgb(124_58_237/0.9)]" : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                    } ${i === 0 ? "text-[13px]" : i === 1 ? "text-[15px]" : "text-[17px]"}`}
                  >
                    {size.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-6 py-4">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-white">Plain mode</span>
              <span className="mt-0.5 block text-sm text-slate-400">Bigger targets, fewer extras.</span>
            </span>
            <Switch
              checked={prefs.plain}
              onChange={(on) => {
                setPrefs({ plain: on });
                toast.success(on ? "Plain mode on: bigger targets, fewer extras." : "Plain mode off.");
              }}
              label="Plain mode"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-6 pb-1 pt-4">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-white">Reduce motion</span>
              <span className="mt-0.5 block text-sm text-slate-400">Nothing pulses, slides or counts up.</span>
            </span>
            <Switch checked={reduceMotion} onChange={toggleReduceMotion} label="Reduce motion" />
          </label>
        </div>
      </Card>

      {/* Language */}
      <Card as="section" aria-labelledby="language-heading">
        <GroupHead icon={<Languages size={18} strokeWidth={1.75} />}>
          <SectionTitle id="language-heading" className="!mb-0">
            Language Tempo speaks to you
          </SectionTitle>
          <p className="mt-0.5 text-sm text-slate-400">Scam warnings are spoken in this language; the chat&apos;s own replies are English tonight.</p>
        </GroupHead>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {LANGUAGES.map((l) => {
            const on = language === l.code;
            return (
              <button
                key={l.code}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onLanguage(l.code);
                  if (language !== l.code) toast.success(`Scam warnings will be spoken in ${l.name}.`);
                }}
                lang={l.bcp47}
                className={`${TAP} relative flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none ${FOCUS} ${
                  on ? "border-violet-400/50 bg-violet-500/[0.16] font-medium text-white shadow-glow" : "border-white/[0.08] bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                {on && <Check size={13} aria-hidden className="shrink-0 text-violet-200" />}
                {l.name}
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-100">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
          Translations are machine-written and not yet checked.
        </p>
      </Card>

      {/* Voice */}
      <Card as="section" aria-labelledby="voice-heading" tone={ttsConfigured || hasElevenLabsKey ? "indigo" : "default"}>
        <GroupHead
          icon={<AudioLines size={18} strokeWidth={1.75} />}
          right={ttsConfigured ? <Badge tone="emerald" dot>Gateway voice on</Badge> : ttsConfigured === false ? <Badge tone="slate" dot>browser voice</Badge> : null}
        >
          <SectionTitle id="voice-heading" className="!mb-0">
            Voice
          </SectionTitle>
          <p className="mt-0.5 text-sm text-slate-400">Who reads Tempo&apos;s replies aloud.</p>
        </GroupHead>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          Replies are read aloud by the Gateway's ElevenLabs voice when it has a key (the key never reaches this browser). Without one, the browser's own voice speaks and the face still moves. A key pasted here is a third path, for the desktop app, kept on this device.
        </p>
        <KeyRow
          text={hasElevenLabsKey ? `ElevenLabs key: ••••••••${elevenLabsKey?.slice(-4)}` : "ElevenLabs key: not set (optional)"}
          set={hasElevenLabsKey}
          button={
            <Button variant="quiet" size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => openKey("elevenlabs", elevenLabsKey || "")} className={TAP} aria-label={hasElevenLabsKey ? "Edit the ElevenLabs key" : "Add an ElevenLabs key"}>
              {hasElevenLabsKey ? "Edit key" : "Add key"}
            </Button>
          }
        />
      </Card>

      {/* Models */}
      <section aria-labelledby="models-heading" className="space-y-3">
        <div className="px-1">
          <h2 id="models-heading" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Model providers</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Honest label: this picker names the reply. The Gateway's deployment mode ({health?.deploy ?? "unknown"}) decides which models sit on the Consensus Court, and <strong className="font-semibold text-white">no model ever sets an amount</strong>: the Rights Engine's rules do.
          </p>
        </div>
        {errorMsg && (
          <div role="alert" className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/[0.08] p-4 text-sm text-amber-100">
            <ShieldAlert className="shrink-0 text-amber-300" size={18} aria-hidden />
            <p>{errorMsg}</p>
          </div>
        )}
        <Card padding="none" className="divide-y divide-white/[0.06] overflow-hidden">
          {AVAILABLE_MODELS.map((model) => {
            const isActive = activeModels.includes(model.id);
            const isPrimaryLocal = model.id === "local";
            const providerKey = model.requiresApiKey ? apiKeys[model.id as ApiKeyProvider] : null;
            const hasKey = !model.requiresApiKey || Boolean(providerKey && providerKey.trim().length > 0);
            const ModelIcon = MODEL_ICONS[model.id] ?? Bot;
            return (
              <div key={model.id} className={`px-5 py-4 transition-colors motion-reduce:transition-none lg:px-6 ${isActive ? "bg-violet-500/[0.04]" : ""}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span
                      aria-hidden
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${
                        isPrimaryLocal ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/25" : isActive ? "bg-violet-500/15 text-violet-200 ring-violet-400/25" : "bg-white/[0.05] text-slate-300 ring-white/10"
                      }`}
                    >
                      <ModelIcon size={18} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium text-white">{model.name}</span>
                        {isPrimaryLocal && <Badge tone="emerald"><ShieldCheck size={12} aria-hidden /> Private</Badge>}
                        {isActive && !isPrimaryLocal && <Badge tone="indigo"><Sparkles size={12} aria-hidden /> On</Badge>}
                      </div>
                      <p className="text-sm leading-snug text-slate-400">{model.description}</p>
                    </div>
                  </div>
                  <Switch checked={isActive} disabled={!hasKey && !isActive} onChange={(checked) => handleToggle(model, checked)} label={`Enable ${model.name}`} />
                </div>
                {model.requiresApiKey && (
                  <div className="pl-[54px]">
                    <KeyRow
                      text={hasKey ? `Key: ••••••••${providerKey?.slice(-4)}` : "Key: not set"}
                      set={hasKey}
                      button={
                        <Button variant="quiet" size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => { const provider = model.id as ApiKeyProvider; openKey(provider, apiKeys[provider] || ""); }} className={TAP} aria-label={`${hasKey ? "Edit the" : "Add a"} ${model.name} key`}>
                          {hasKey ? "Edit key" : "Add key"}
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </section>

      {editingProvider && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="key-dialog-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeKey();
            }
          }}
        >
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 motion-safe:animate-scale-in">
            <div className="mb-2 flex items-center gap-3 text-slate-100">
              <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/25">
                <Lock size={17} />
              </span>
              <h2 id="key-dialog-heading" className="text-[17px] font-semibold text-white">Set the {PROVIDER_LABELS[editingProvider]} key</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
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

/** A group's header: an icon tile, the title (and a line under it), and a status on the right. */
function GroupHead({ icon, children, right }: { icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-violet-500/25 to-violet-700/10 text-violet-100 ring-1 ring-inset ring-violet-300/20">
          {icon}
        </span>
        <div className="min-w-0 pt-0.5">{children}</div>
      </div>
      {right && <div className="pt-1">{right}</div>}
    </div>
  );
}

/** One setting: what it is on the left, its control on the right. */
function Row({ title, description, control }: { title: string; description: ReactNode; control: ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-6 border-t border-white/[0.06] pt-4">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-white">{title}</p>
        <p className="mt-0.5 text-sm text-slate-400">{description}</p>
      </div>
      {control}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/20 px-3.5 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-100">{value}</dd>
    </div>
  );
}

function KeyRow({ text, set, button }: { text: string; set: boolean; button: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 py-2 pl-3.5 pr-2">
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-slate-300">
        <Key size={14} className={set ? "text-emerald-300" : "text-slate-400"} aria-hidden />
        <span className="min-w-0 break-all">{text}</span>
      </div>
      {button}
    </div>
  );
}
