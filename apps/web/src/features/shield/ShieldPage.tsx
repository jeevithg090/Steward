// Scam Shield (plan.md §2): paste a text, hear the verdict in six languages; zones warn/hold/quiet;
// the reasons and link findings; the Shield log; "that was real" feedback. And Margaret's Tuesday,
// the story narrated aloud with captions. The language starts from Settings and can be changed here.
import { useMemo, useState } from "react";
import { BookOpenText, ShieldAlert } from "lucide-react";
import { FOCUS, PageTitle } from "@/components/ui";
import { type Language, ShieldClient, type ShieldSource, ShowcaseShield, browserNarrator } from "@/lib/shield";
import type { PageProps } from "@/types/page";
import { ShieldPanel } from "./ShieldPanel";
import { ShieldStory } from "./ShieldStory";

type Tab = "check" | "story";

const TABS: { id: Tab; label: string; icon: typeof ShieldAlert }[] = [
  { id: "check", label: "Check a message", icon: ShieldAlert },
  { id: "story", label: "Margaret's Tuesday", icon: BookOpenText },
];

export default function ShieldPage({ user, showcase, language: initial, speak }: PageProps) {
  const source = useMemo<ShieldSource>(() => (showcase ? new ShowcaseShield() : new ShieldClient()), [showcase]);
  const narrator = useMemo(() => browserNarrator(), []);
  const [tab, setTab] = useState<Tab>("check");
  const [language, setLanguage] = useState<Language>(initial);

  return (
    <div className="space-y-5">
      <PageTitle lede="An agent that runs in the background on the phone, reads incoming texts on the device, and speaks when one is a trick. Built for people who cannot read the letter, hear the call or trust the message, and are the ones scammers target.">
        Scam Shield
      </PageTitle>

      <div role="tablist" aria-label="Scam Shield" className="inline-flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={selected ? `panel-${t.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = TABS[(TABS.findIndex((x) => x.id === tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
                  setTab(next.id);
                  document.getElementById(`tab-${next.id}`)?.focus();
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${FOCUS} ${selected ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
            >
              <Icon size={14} aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "check" ? (
          <ShieldPanel source={source} language={language} onLanguage={setLanguage} userId={user.id} speak={speak} />
        ) : (
          <ShieldStory narrator={narrator} language={language} onLanguage={setLanguage} />
        )}
      </div>
    </div>
  );
}
