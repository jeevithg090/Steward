// Tempo's web app (plan.md): the teammate's shell and chat, extended with hash routes to every
// page, one Gateway client resolved from config (or the showcase), the honesty badge, live events
// and the user's profile. Pages get everything through PageProps and never read env themselves.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { EmptyState, HonestyBadge, Spinner, Toaster, toast } from "./components/ui";
import { GatewayBanner } from "./components/layout/GatewayBanner";
import catalogJson from "./showcase/catalog.json";
import ChatContainer from "./features/chat/ChatContainer";
import { chatStore, useChatStore } from "./features/chat/store";
import { LANGUAGE_KEY, SettingsPage, readLanguage } from "./features/settings/SettingsPage";
import { Gateway, type Health, type LedgerTotals } from "./lib/api";
import { gatewayConfig, setGatewayOverride, setShowcaseOverride, showcaseEnabled, showcaseForcedByBuild } from "./lib/config";
import { useLiveEvents } from "./lib/live";
import { MeshProvider } from "./lib/mesh-context";
import type { Language } from "./lib/shield";
import { ShowcaseGateway } from "./lib/showcase";
import { navigate, section, useRoute } from "./router";
import type { PageProps, PageUser } from "./types/page";
import type { ApiKeyProvider, ApiKeys, ModelProvider } from "./types/types";

const MissionsPage = lazy(() => import("./features/missions/MissionsPage"));
const MemoryPage = lazy(() => import("./features/memory/MemoryPage"));
const ProfilesPage = lazy(() => import("./features/profiles/ProfilesPage"));
const SkillsPage = lazy(() => import("./features/skills/SkillsPage"));
const ShieldPage = lazy(() => import("./features/shield/ShieldPage"));
const ReadPage = lazy(() => import("./features/read/ReadPage"));
const OwedPage = lazy(() => import("./features/owed/OwedPage"));
const CallersPage = lazy(() => import("./features/callers/CallersPage"));
const PrivacyPage = lazy(() => import("./features/privacy/PrivacyPage"));
const StoryPage = lazy(() => import("./features/story/StoryPage"));
const DevicesPage = lazy(() => import("./features/devices/DevicesPage"));

// API keys entered in Settings, kept on this device so they survive a reload.
const API_KEYS_STORAGE = "tempo_api_keys";
const PROFILE_KEY = "tempo.profile";
const EMPTY_KEYS: ApiKeys = { claude: "", openai: "", elevenlabs: "" };

function loadApiKeys(): ApiKeys {
  try {
    return { ...EMPTY_KEYS, ...JSON.parse(localStorage.getItem(API_KEYS_STORAGE) || "{}") };
  } catch {
    return EMPTY_KEYS;
  }
}

function loadProfile(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

const PAGE_TITLES: Record<string, string> = {
  "/chat": "Chat", "/missions": "Mission Control", "/memory": "Memory", "/profiles": "Profiles", "/skills": "Skills",
  "/shield": "Scam Shield", "/read": "Read It To Me", "/owed": "Am I Owed Anything?", "/callers": "Who's calling?",
  "/privacy": "Privacy Proof", "/story": "The story", "/settings": "Settings", "/devices": "Devices", "/pair": "Join Tempo",
};

const PROFILE_NAMES: Record<string, string> = Object.fromEntries(
  (catalogJson as { profiles: { id: string; name: string }[] }).profiles.map((p) => [p.id, p.name]),
);

/** The demo's person (seeded by `make seed`). */
const DEMO_USER = { id: "u_margaret", name: "Margaret" };

export default function App() {
  const route = useRoute();
  const current = section(route.path);

  // One Gateway for the whole app: the showcase's recordings, or the configured server.
  const [showcase, setShowcase] = useState(showcaseEnabled);
  const [configVersion, setConfigVersion] = useState(0);
  const config = useMemo(() => gatewayConfig(), [configVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const gateway = useMemo<Gateway>(() => (showcase ? new ShowcaseGateway() : new Gateway(config)), [showcase, config]);

  const [health, setHealth] = useState<Health | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [retry, setRetry] = useState(0);
  const [ttsConfigured, setTtsConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const h = await gateway.health();
        if (live) setHealth(h);
      } catch {
        if (live) setHealth(null);
      } finally {
        if (live) setHealthChecked(true);
      }
    };
    void poll();
    void gateway.ttsConfigured().then((ok) => live && setTtsConfigured(ok));
    const timer = setInterval(poll, 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [gateway, retry]);

  const { events, connected } = useLiveEvents(showcase ? null : gateway.eventsUrl());

  // The Time Ledger for the sidebar: refreshed when money arrives.
  const [ledger, setLedger] = useState<LedgerTotals | null>(null);
  const ledgerTick = events.filter((e) => e.type === "ledger" || e.type === "outcome").length;
  useEffect(() => {
    let live = true;
    gateway
      .ledger()
      .then((l) => live && setLedger(l))
      .catch(() => live && setLedger(null));
    return () => {
      live = false;
    };
  }, [gateway, ledgerTick, health]);

  const [profileId, setProfileId] = useState<string | null>(loadProfile);
  const setProfile = useCallback((id: string | null) => {
    setProfileId(id);
    try {
      if (id) localStorage.setItem(PROFILE_KEY, id);
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  const user: PageUser = useMemo(() => ({ ...DEMO_USER, profileId }), [profileId]);

  const [language, setLanguageState] = useState<Language>(readLanguage);
  const setLanguage = (l: Language) => {
    setLanguageState(l);
    try {
      localStorage.setItem(LANGUAGE_KEY, l);
    } catch {
      /* ignore */
    }
  };

  // The teammate's model picker and keys (Settings).
  const [activeModels, setActiveModels] = useState<ModelProvider[]>(["local"]);
  const [selectedModel, setSelectedModel] = useState<ModelProvider>("local");
  const [apiKeys, setApiKeys] = useState<ApiKeys>(loadApiKeys);
  useEffect(() => {
    try {
      localStorage.setItem(API_KEYS_STORAGE, JSON.stringify(apiKeys));
    } catch {
      /* storage unavailable: keys last until reload */
    }
  }, [apiKeys]);

  const handleToggleActiveModel = (model: ModelProvider, active: boolean) => {
    setActiveModels((prev) => {
      if (active) return prev.includes(model) ? prev : [...prev, model];
      const next = prev.filter((m) => m !== model);
      const updated: ModelProvider[] = next.length > 0 ? next : ["local"];
      if (!updated.includes(selectedModel)) setSelectedModel(updated[0]!);
      return updated;
    });
  };
  const handleUpdateApiKey = (provider: ApiKeyProvider, key: string) => setApiKeys((prev) => ({ ...prev, [provider]: key }));

  // Sidebar history comes from the chat store.
  const { conversations } = useChatStore();
  const history = conversations.map((c) => c.title);

  const speak = useCallback((text: string) => chatStore.setSpeech({ id: crypto.randomUUID(), text }), []);

  // Each page names itself in the tab and, after the first load, moves focus to its content so a
  // screen reader hears the new page (the skip link still leads there too).
  const firstRoute = useRef(true);
  useEffect(() => {
    document.title = `${PAGE_TITLES[current] ?? "Tempo"} · Tempo`;
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [current]);

  const profileName = profileId ? (PROFILE_NAMES[profileId] ?? profileId) : null;

  const pageProps: PageProps = {
    gateway,
    user,
    showcase,
    health,
    connected,
    events,
    language,
    params: route.params,
    speak,
    setProfile,
  };

  const page = (() => {
    switch (current) {
      case "/chat":
        return (
          <ChatContainer
            {...pageProps}
            config={config}
            activeModels={activeModels}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            elevenLabsKey={apiKeys.elevenlabs?.trim() || undefined}
          />
        );
      case "/missions":
        return <MissionsPage {...pageProps} />;
      case "/memory":
        return <MemoryPage {...pageProps} />;
      case "/profiles":
        return <ProfilesPage {...pageProps} />;
      case "/skills":
        return <SkillsPage {...pageProps} />;
      case "/shield":
        return <ShieldPage {...pageProps} />;
      case "/read":
        return <ReadPage {...pageProps} />;
      case "/owed":
        return <OwedPage {...pageProps} />;
      case "/callers":
        return <CallersPage {...pageProps} />;
      case "/privacy":
        return <PrivacyPage {...pageProps} />;
      case "/story":
        return <StoryPage {...pageProps} />;
      case "/devices":
      case "/pair":
        return <DevicesPage {...pageProps} />;
      case "/settings":
        return (
          <SettingsPage
            gatewayUrl={config.url}
            token={config.token}
            showcase={showcase}
            showcaseForced={showcaseForcedByBuild()}
            onSaveGateway={(url, token) => {
              setGatewayOverride(url || null, token || null);
              setConfigVersion((v) => v + 1);
            }}
            onToggleShowcase={(on) => {
              setShowcaseOverride(on);
              setShowcase(on);
              chatStore.reset();
            }}
            health={health}
            ttsConfigured={ttsConfigured}
            language={language}
            onLanguage={setLanguage}
            activeModels={activeModels}
            onToggleActiveModel={handleToggleActiveModel}
            apiKeys={apiKeys}
            onUpdateApiKey={handleUpdateApiKey}
          />
        );
      default:
        return (
          <div className="py-10">
            <h1 className="sr-only">Page not found</h1>
            <EmptyState
              title={`There is no page at ${route.path}.`}
              action={
                <button onClick={() => navigate("/chat")} className="rounded-full bg-indigo-600 px-4 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                  Back to the chat
                </button>
              }
            >
              The menu lists every page.
            </EmptyState>
          </div>
        );
    }
  })();

  return (
    <MeshProvider config={config} showcase={showcase}>
    <AppShell
      section={current}
      history={history}
      profileName={profileName}
      ledger={ledger ? { gbp: ledger.gbp_recovered, hours: ledger.hours_returned } : null}
      banner={
        !showcase && healthChecked && health === null ? (
          <GatewayBanner
            url={config.url}
            onRetry={() => {
              setHealthChecked(false);
              setRetry((r) => r + 1);
            }}
            onShowcase={() => {
              setShowcaseOverride(true);
              setShowcase(true);
              chatStore.reset();
              toast.info("Showcase on: every page now answers from recorded replies. Switch back in Settings.");
            }}
          />
        ) : null
      }
      onNewChat={() => {
        chatStore.newChat();
        navigate("/chat");
      }}
      onSelectChat={(index) => {
        const target = chatStore.selectIndex(index);
        if (target) {
          const lastAgent = [...target.messages].reverse().find((m) => m.role === "agent");
          if (lastAgent) chatStore.setSpeech({ id: lastAgent.id, text: lastAgent.text });
        }
        navigate("/chat");
      }}
      badge={<HonestyBadge health={health} showcase={showcase} connected={showcase || connected || health !== null} />}
    >
      <Suspense fallback={<div className="py-10"><Spinner label="Loading the page" /></div>}>{page}</Suspense>
      <Toaster />
    </AppShell>
    </MeshProvider>
  );
}
