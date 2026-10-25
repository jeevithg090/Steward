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
    <div className="space-y-6">
      <PageTitle lede="An agent that runs in the background on the phone, reads incoming texts on the device, and speaks when one is a trick. Built for people who cannot read the letter, hear the call or trust the message, and are the ones scammers target.">
        Scam Shield
      </PageTitle>

      <div role="tablist" aria-label="Scam Shield" className="grid w-full grid-cols-2 gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 shadow-[0_1px_0_0_rgb(255_255_255/0.04)_inset] sm:inline-flex sm:w-auto">
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
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 sm:px-5 motion-reduce:transition-none ${FOCUS} ${
                selected
                  ? "bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.2)_inset,0_10px_24px_-12px_rgb(124_58_237/0.9)]"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon size={15} aria-hidden className={selected ? "text-violet-100" : "text-slate-400"} /> {t.label}
            </button>
          );
        })}
      </div>

      <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="motion-safe:animate-fade-up">
        {tab === "check" ? (
          <ShieldPanel source={source} language={language} onLanguage={setLanguage} userId={user.id} speak={speak} />
        ) : (
          <ShieldStory narrator={narrator} language={language} onLanguage={setLanguage} />
        )}
      </div>
    </div>
  );
}
