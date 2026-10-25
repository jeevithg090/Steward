import { useState } from "react";
import { AudioLines, Check, Key, Lock, Pencil, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { Switch } from "../../components/ui/Switch";
import type { ApiKeyProvider, ApiKeys, ModelOption, ModelProvider } from "../../types/types";

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "local",
    name: "Local Model (Primary • Ollama / Llama)",
    description: "Runs 100% locally on your desktop hardware. Zero data leaves your Mac/PC. Free & private.",
    requiresApiKey: false,
  },
  {
    id: "gemini",
    name: "Gemini Pro",
    description: "Built-in Google multimodal agent model. Ready out of the box.",
    requiresApiKey: false,
  },
  {
    id: "claude",
    name: "Claude 3.5 Sonnet",
    description: "Anthropic's flagship model for reasoning and complex code.",
    requiresApiKey: true,
  },
  {
    id: "openai",
    name: "GPT-4o",
    description: "OpenAI's flagship multimodal intelligence.",
    requiresApiKey: true,
  },
];

const PROVIDER_LABELS: Record<ApiKeyProvider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

interface SettingsPageProps {
  activeModels: ModelProvider[];
  onToggleActiveModel: (model: ModelProvider, active: boolean) => void;
  apiKeys: ApiKeys;
  onUpdateApiKey: (provider: ApiKeyProvider, key: string) => void;
}

export function SettingsPage({
  activeModels,
  onToggleActiveModel,
  apiKeys,
  onUpdateApiKey,
}: SettingsPageProps) {
  const [editingProvider, setEditingProvider] = useState<ApiKeyProvider | null>(null);
  const [tempKeyInput, setTempKeyInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const elevenLabsKey = apiKeys.elevenlabs;
  const hasElevenLabsKey = Boolean(elevenLabsKey && elevenLabsKey.trim().length > 0);

  const handleToggle = (model: ModelOption, enable: boolean) => {
    setErrorMsg(null);

    if (enable && model.requiresApiKey) {
      const provider = model.id as ApiKeyProvider;
      const key = apiKeys[provider];
      if (!key || key.trim().length === 0) {
        setErrorMsg(`An API key is required to activate ${model.name}. Please enter a key below.`);
        setEditingProvider(provider);
        setTempKeyInput("");
        return;
      }
    }

    onToggleActiveModel(model.id, enable);
  };

  const handleSaveKey = (provider: ApiKeyProvider) => {
    onUpdateApiKey(provider, tempKeyInput.trim());

    // Only model providers have an on/off switch; voice just stores the key.
    if (provider !== "elevenlabs" && tempKeyInput.trim().length > 0) {
      onToggleActiveModel(provider, true);
      setErrorMsg(null);
    }

    setEditingProvider(null);
    setTempKeyInput("");
  };

  const isVoiceEdit = editingProvider === "elevenlabs";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Model Provider Settings</h1>
        <p className="mt-1 text-xs text-slate-400">
          Enable or disable model providers. Local Model runs completely offline on your device hardware.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <ShieldAlert className="shrink-0 text-amber-400" size={18} />
          <p>{errorMsg}</p>
        </div>
      )}

      <div className="space-y-3">
        {AVAILABLE_MODELS.map((model) => {
          const isActive = activeModels.includes(model.id);
          const isPrimaryLocal = model.id === "local";
          const providerKey = model.requiresApiKey
            ? apiKeys[model.id as ApiKeyProvider]
            : null;
          const hasKey = !model.requiresApiKey || Boolean(providerKey && providerKey.trim().length > 0);

          return (
            <div
              key={model.id}
              className={`flex flex-col gap-4 rounded-xl border p-5 transition-colors ${
                isPrimaryLocal
                  ? "border-emerald-500/40 bg-emerald-950/20 shadow-lg shadow-emerald-950/10"
                  : isActive
                  ? "border-indigo-500/50 bg-indigo-950/30"
                  : "border-slate-800 bg-slate-900/90"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">{model.name}</span>
                    {isPrimaryLocal && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                        <ShieldCheck size={12} /> Primary • 100% Private
                      </span>
                    )}
                    {isActive && !isPrimaryLocal && (
                      <span className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">
                        <Sparkles size={12} /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{model.description}</p>
                </div>

                <Switch
                  checked={isActive}
                  disabled={!hasKey && !isActive}
                  onChange={(checked) => handleToggle(model, checked)}
                  label={`Enable ${model.name}`}
                />
              </div>

              {model.requiresApiKey && (
                <div className="border-t border-slate-800/80 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <Key size={14} className="text-slate-500" />
                      <span>
                        {hasKey
                          ? `API Key: ••••••••••••${providerKey?.slice(-4)}`
                          : "API Key: Not configured (Required)"}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        const provider = model.id as ApiKeyProvider;
                        setEditingProvider(provider);
                        setTempKeyInput(apiKeys[provider] || "");
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
                    >
                      <Pencil size={12} />
                      {hasKey ? "Edit Key" : "Add Key"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Voice output (ElevenLabs) */}
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Voice</h2>
        <p className="mt-1 text-xs text-slate-400">
          Used when the avatar panel is in Avatar or Voice mode to read replies aloud.
        </p>
      </div>

      <div
        className={`flex flex-col gap-4 rounded-xl border p-5 transition-colors ${
          hasElevenLabsKey ? "border-indigo-500/50 bg-indigo-950/30" : "border-slate-800 bg-slate-900/90"
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AudioLines size={16} className="text-indigo-300" />
            <span className="font-medium text-slate-100">ElevenLabs Text-to-Speech</span>
            {hasElevenLabsKey && (
              <span className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">
                <Sparkles size={12} /> Key set
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Gives each agent persona its own spoken voice. Without a key here, the Gateway's own ElevenLabs key
            is used if it has one.
          </p>
        </div>

        <div className="border-t border-slate-800/80 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Key size={14} className="text-slate-500" />
              <span>
                {hasElevenLabsKey
                  ? `API Key: ••••••••••••${elevenLabsKey?.slice(-4)}`
                  : "API Key: Not configured (Optional)"}
              </span>
            </div>

            <button
              onClick={() => {
                setEditingProvider("elevenlabs");
                setTempKeyInput(elevenLabsKey || "");
              }}
              className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
            >
              <Pencil size={12} />
              {hasElevenLabsKey ? "Edit Key" : "Add Key"}
            </button>
          </div>
        </div>
      </div>

      {editingProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-slate-100">
              <Lock size={18} className="text-indigo-400" />
              <h2 className="font-semibold">Set {PROVIDER_LABELS[editingProvider]} API Key</h2>
            </div>
            <p className="mb-4 text-xs text-slate-400">
              Keys are stored locally on your desktop device.
              {isVoiceEdit && " Leave the field empty and save to remove the key."}
            </p>

            <input
              type="password"
              placeholder={`Enter ${PROVIDER_LABELS[editingProvider]} API Key...`}
              value={tempKeyInput}
              onChange={(e) => setTempKeyInput(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-black/50 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              autoFocus
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingProvider(null);
                  setTempKeyInput("");
                }}
                className="rounded-lg px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveKey(editingProvider)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <Check size={14} /> {isVoiceEdit ? "Save" : "Save & Activate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}