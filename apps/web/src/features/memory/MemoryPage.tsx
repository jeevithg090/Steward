// Memory (plan.md §2): the Memory Card by category with source, date and trust; the timeline with
// superseded facts struck through; Forget (everywhere), Correct, Erase all, each confirmed with a
// toast. Ported from the old MemoryCard and re-skinned for the dark theme. Company text is
// evidence, never memory.
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Brain, CalendarClock, CalendarDays, Check, Ear, FileCheck, Gauge, Globe, HeartPulse, History, Hourglass, House, Info, Landmark, MessageCircle, MessageSquareText, MousePointerClick, Pencil, Phone, PoundSterling, SlidersHorizontal, TrainFront, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, SkeletonCards, toast } from "@/components/ui";
import type { MemoryCardData, MemoryItem, TemporalFact } from "@/lib/api";
import { linkProps } from "@/router";
import type { PageProps } from "@/types/page";
import { SAY, TAP, chatSay } from "../story/demo";
import { loadError } from "@/components/mission/words";
import { Figure } from "../profiles/bits";

export const SOURCE_WORDS: Record<string, string> = {
  user_voice: "you said, by phone",
  user_sms: "you texted",
  user_web: "you said, here",
  user_chat: "you said, in the chat",
  official_api: "official data",
};

export const CATEGORY_WORDS: Record<string, string> = {
  preference: "Preferences",
  contact: "People",
  journey: "Journeys",
  household: "Home",
  mission_fact: "Claims",
  health: "Health",
  immigration: "Immigration",
  finance: "Money",
  access: "How to speak with me",
};

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

const CATEGORY_ICONS: Record<string, Icon> = {
  preference: SlidersHorizontal,
  contact: Users,
  journey: TrainFront,
  household: House,
  mission_fact: FileCheck,
  health: HeartPulse,
  immigration: Globe,
  finance: PoundSterling,
  access: Ear,
};

const CATEGORY_NOTES: Record<string, string> = {
  access: "Kept only because you said yes. It never expires; forget it any time.",
};

const KIND_WORDS: Record<string, string> = {
  appointment: "Appointment",
  promise: "Promise",
  payment: "Payment",
  claim: "Claim",
  deadline: "Deadline",
};

/** Events whose arrival means the card may have changed. */
const REFRESH_ON = new Set(["ledger", "outcome", "state_changed"]);

export function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

export function factText(f: TemporalFact): string {
  return `${f.subject} ${f.predicate.replaceAll("_", " ")} ${f.object}`;
}

function sourceWords(source: string): string {
  return SOURCE_WORDS[source] ?? source.replaceAll("_", " ");
}

function categoryWords(category: string): string {
  return CATEGORY_WORDS[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replaceAll("_", " ");
}

function failure(e: unknown): string {
  return `That didn't work: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, ".")} Try again, or check the Gateway in Settings.`;
}

const INPUT = `min-h-[44px] w-full rounded-2xl border border-white/10 bg-ink-900/70 px-3.5 py-2 text-sm text-slate-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] placeholder:text-slate-500 transition-colors hover:border-white/20 focus:border-violet-400/60 ${FOCUS}`;

const SOURCE_ICONS: Record<string, Icon> = { user_voice: Phone, user_sms: MessageSquareText, user_web: MousePointerClick, user_chat: MessageCircle, official_api: Landmark };

export default function MemoryPage({ gateway, user, showcase, events }: PageProps) {
  const [card, setCard] = useState<MemoryCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [erasing, setErasing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCard(await gateway.memories(user.id));
      setError(null);
    } catch (e) {
      setError(loadError(e));
    }
  }, [gateway, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A mission moved or paid: the card may have gained a fact. Events are newest first.
  const newest = events[0];
  useEffect(() => {
    if (newest && REFRESH_ON.has(newest.type)) void load();
  }, [newest, load]);

  const groups = useMemo(() => Object.entries(card?.memories ?? {}), [card]);
  const total = groups.reduce((n, [, entries]) => n + entries.length, 0);

  const run = async (key: string, action: () => Promise<unknown>, said: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(said);
      await load();
    } catch (e) {
      toast.error(failure(e));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const forget = (item: MemoryItem) => run(item.id, () => gateway.forgetMemory(user.id, item.id), `Forgotten: “${item.text}”. Gone from every device and every door.`);
  const forgetFact = (fact: TemporalFact) => run(fact.id, () => gateway.forgetEpisode(user.id, fact.episode_id), `Forgotten: ${factText(fact)}.`);
  const correct = (item: MemoryItem, text: string) =>
    run(item.id, () => gateway.correctMemory(user.id, item.id, text), "Corrected. The earlier words stay visible, struck through, so you can see what changed.");

  const eraseAll = async () => {
    if (!card) return;
    const items = groups.flatMap(([, entries]) => entries.map((e) => e.item));
    const episodes = [...new Set(card.timeline.map((f) => f.episode_id))];
    await run(
      "erase-all",
      async () => {
        for (const item of items) await gateway.forgetMemory(user.id, item.id);
        for (const episode of episodes) await gateway.forgetEpisode(user.id, episode);
      },
      `Erased ${items.length} ${items.length === 1 ? "memory" : "memories"} and ${episodes.length} dated ${episodes.length === 1 ? "fact" : "facts"}. Tempo now remembers nothing about you.`,
    );
    setErasing(false);
  };

  const hasAnything = total > 0 || (card?.timeline.length ?? 0) > 0;
  const current = card?.timeline.filter((f) => !(f.valid_to || f.superseded_by)).length ?? 0;

  return (
    <div className="space-y-8">
      <PageTitle
        lede="What Tempo remembers about you, where each thing came from, and when. Forget any of it; the next call forgets it too."
        right={
          hasAnything ? (
            erasing ? (
              <div role="group" aria-label="Erase everything?" className="glass-strong flex flex-wrap items-center gap-2 rounded-3xl border-rose-400/40 p-2 text-sm motion-safe:animate-scale-in">
                <span className="flex items-center gap-2 px-2 text-rose-50">
                  <TriangleAlert size={15} aria-hidden className="shrink-0 text-rose-300" />
                  Erase everything Tempo remembers? This can't be undone.
                </span>
                <Button variant="danger" busy={busy === "erase-all"} onClick={() => void eraseAll()} icon={<Trash2 size={14} aria-hidden />} className={TAP}>
                  Yes, erase all
                </Button>
                <Button variant="quiet" onClick={() => setErasing(false)} icon={<X size={14} aria-hidden />} className={TAP}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button
                variant="quiet"
                onClick={() => setErasing(true)}
                disabled={busy !== null}
                icon={<Trash2 size={14} aria-hidden />}
                className={`${TAP} !border-rose-400/30 !text-rose-100 hover:!border-rose-400/50 hover:!bg-rose-500/10`}
              >
                Erase all
              </Button>
            )
          ) : null
        }
      >
        Memory
      </PageTitle>

      <Card tone="indigo" padding="none" className="relative overflow-hidden motion-safe:animate-fade-up">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr] lg:items-center lg:p-6">
          <div className="flex items-start gap-4">
            <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-violet-500/30 to-violet-700/10 text-violet-100 ring-1 ring-inset ring-violet-300/25 shadow-[0_12px_30px_-14px_rgb(124_58_237/0.9)]">
              <Brain size={22} strokeWidth={1.75} />
            </span>
            <p className="text-[15px] leading-relaxed text-slate-200">
              <strong className="font-semibold text-white">The Memory Gate.</strong> Company text is evidence, never memory. Only what you said and official data can be
              remembered, and only with a date, a source and a way to forget it.
            </p>
          </div>
          {card && (
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
              <Figure label="Remembered" value={String(total)} icon={<Brain size={12} aria-hidden />} sub={total === 1 ? "thing you told it" : "things you told it"} />
              <Figure label="Dated facts" value={String(card.timeline.length)} icon={<CalendarClock size={12} aria-hidden />} sub={`${current} still current`} />
            </div>
          )}
        </div>
      </Card>

      {error && (
        <EmptyState title="Couldn't load the Memory Card" tone="error" action={<Button variant="quiet" onClick={() => void load()} className={TAP}>Try again</Button>}>
          {error.replace(/\.?$/, ".")} Check the Gateway in Settings, or switch on the showcase there.
        </EmptyState>
      )}
      {!error && !card && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <SkeletonCards count={3} label="Loading what Tempo remembers" />
          <SkeletonCards count={2} label="Loading the timeline" />
        </div>
      )}

      {card && (
        <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="memories-heading" className="min-w-0 space-y-4">
            <SectionTitle id="memories-heading" right={<span className="num text-xs text-slate-400">{total} {total === 1 ? "memory" : "memories"}</span>}>
              <Brain size={12} aria-hidden /> The Memory Card
            </SectionTitle>
            {groups.length === 0 ? (
              <EmptyState
                title="Nothing yet"
                icon={<Brain size={28} aria-hidden />}
                action={
                  <a
                    {...linkProps(chatSay(SAY.remember))}
                    className={`inline-flex ${TAP} items-center gap-2 rounded-full bg-gradient-to-b from-violet-600 to-violet-700 px-4 text-sm font-medium text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_10px_28px_-12px_rgb(124_58_237/0.9)] hover:from-violet-500 hover:to-violet-700 ${FOCUS}`}
                  >
                    <MessageCircle size={14} aria-hidden /> Ask in the chat: “{SAY.remember}”
                  </a>
                }
              >
                Tempo only remembers what you tell it, and only with your yes. Tell it in the chat how you like to be spoken to, or ask what it knows.
                {showcase ? " In the showcase, Margaret's recorded memories appear here until you forget them." : ""}
              </EmptyState>
            ) : (
              <div className="stagger space-y-4">
                {groups.map(([category, entries]) => {
                  const CategoryIcon = CATEGORY_ICONS[category] ?? Brain;
                  return (
                    <Card key={category} as="section" aria-labelledby={`cat-${category}`}>
                      <div className="mb-4 flex items-center gap-3">
                        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-violet-500/25 to-violet-700/10 text-violet-100 ring-1 ring-inset ring-violet-300/20">
                          <CategoryIcon size={18} />
                        </span>
                        <div className="min-w-0">
                          <h3 id={`cat-${category}`} className="text-[15px] font-semibold text-white">
                            {categoryWords(category)}
                          </h3>
                          {CATEGORY_NOTES[category] && <p className="mt-0.5 text-xs leading-snug text-slate-400">{CATEGORY_NOTES[category]}</p>}
                        </div>
                        <span className="num ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.07] px-2 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-white/10">
                          {entries.length}
                        </span>
                      </div>
                      <ul className="space-y-2.5">
                        {entries.map(({ item, earlier }) => {
                          const SourceIcon = SOURCE_ICONS[item.source] ?? Brain;
                          return (
                            <li key={item.id} className="group rounded-2xl border border-white/[0.07] bg-black/20 p-4 transition-colors hover:border-white/[0.12] motion-reduce:transition-none">
                              {editing === item.id ? (
                                <form
                                  className="flex flex-wrap items-center gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!draft.trim()) return;
                                    setEditing(null);
                                    void correct(item, draft.trim());
                                  }}
                                >
                                  <label className="sr-only" htmlFor={`edit-${item.id}`}>
                                    Correct this memory
                                  </label>
                                  <input id={`edit-${item.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${INPUT} min-w-0 flex-1 basis-48`} autoFocus />
                                  <Button type="submit" variant="ok" disabled={!draft.trim()} icon={<Check size={14} aria-hidden />} className={TAP}>
                                    Save
                                  </Button>
                                  <Button variant="quiet" onClick={() => setEditing(null)} className={TAP}>
                                    Cancel
                                  </Button>
                                </form>
                              ) : (
                                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                                  <p className="min-w-0 break-words text-base font-medium leading-snug text-white">{item.text}</p>
                                  {item.trust === "trusted" ? (
                                    <Badge tone="emerald" dot>
                                      trusted
                                    </Badge>
                                  ) : (
                                    <Badge tone="amber" dot title="Untrusted text can be looked at, never acted on">
                                      evidence only
                                    </Badge>
                                  )}
                                </div>
                              )}
                              <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                                <Chip icon={<SourceIcon size={11} />}>{sourceWords(item.source)}</Chip>
                                <Chip icon={<CalendarDays size={11} />}>
                                  <span className="num">{day(item.observed_at)}</span>
                                </Chip>
                                <Chip icon={<Gauge size={11} />}>
                                  <span className="num">{Math.round(item.confidence * 100)}% sure</span>
                                </Chip>
                                {item.expires_at && (
                                  <Chip icon={<Hourglass size={11} />}>
                                    <span className="num">kept until {day(item.expires_at)}</span>
                                  </Chip>
                                )}
                              </p>
                              {earlier.length > 0 && (
                                <div className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-2">
                                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                    <History size={11} aria-hidden /> Earlier
                                  </p>
                                  <ul aria-label="Earlier versions" className="mt-1 space-y-0.5 text-xs text-slate-400">
                                    {earlier.map((e, i) => (
                                      <li key={`${e.id}-${i}`}>
                                        <s className="superseded">{e.text}</s> <span>(replaced {day((earlier[i + 1] ?? item).observed_at)})</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="-mb-1.5 mt-2.5 flex flex-wrap items-center gap-1 border-t border-white/[0.05] pt-1.5">
                                {confirming === item.id ? (
                                  <div role="group" aria-label={`Forget ${item.text}?`} className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] p-2 text-sm motion-safe:animate-scale-in">
                                    <span className="flex items-center gap-2 px-1.5 text-rose-50">
                                      <TriangleAlert size={14} aria-hidden className="shrink-0 text-rose-300" />
                                      Forget this everywhere? This can't be undone.
                                    </span>
                                    <Button variant="danger" size="sm" busy={busy === item.id} onClick={() => void forget(item)} className={TAP}>
                                      Yes, forget
                                    </Button>
                                    <Button variant="quiet" size="sm" onClick={() => setConfirming(null)} className={TAP}>
                                      Keep
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={busy !== null}
                                      onClick={() => {
                                        setEditing(item.id);
                                        setDraft(item.text);
                                      }}
                                      icon={<Pencil size={13} aria-hidden />}
                                      aria-label={`Correct ${item.text}`}
                                      className={TAP}
                                    >
                                      Correct
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={busy !== null}
                                      onClick={() => setConfirming(item.id)}
                                      icon={<Trash2 size={13} aria-hidden />}
                                      aria-label={`Forget ${item.text}`}
                                      className={`${TAP} !text-rose-200 hover:!bg-rose-500/10 hover:!text-rose-100`}
                                    >
                                      Forget
                                    </Button>
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="timeline-heading" className="min-w-0 space-y-3">
            <SectionTitle id="timeline-heading">
              <CalendarClock size={12} aria-hidden /> The timeline
            </SectionTitle>
            {card.timeline.length === 0 ? (
              <EmptyState title="No dated facts yet">Appointments and promises with a date land here, and stay visible when they change.</EmptyState>
            ) : (
              <Card>
                <ol aria-label="Timeline" className="relative ml-2">
                  <span aria-hidden className="absolute bottom-2 left-0 top-2 w-px bg-gradient-to-b from-violet-400/60 via-white/10 to-white/5" />
                  {card.timeline.map((fact) => {
                    const gone = Boolean(fact.valid_to || fact.superseded_by);
                    return (
                      <li key={fact.id} className="relative pb-6 pl-6 last:pb-0">
                        <span
                          aria-hidden
                          className={`absolute -left-[6px] top-1 h-3 w-3 rounded-full ring-4 ring-ink-800 ${gone ? "border-2 border-slate-500 bg-ink-800" : "bg-violet-400 shadow-[0_0_12px_2px_rgb(139_92_246/0.6)]"}`}
                        />
                        <p className="num text-xs font-medium text-slate-400">
                          {day(fact.valid_from)} → {fact.valid_to ? day(fact.valid_to) : "still true"}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={gone ? "slate" : "indigo"} dot>
                            {KIND_WORDS[fact.kind] ?? fact.kind.replaceAll("_", " ")}
                          </Badge>
                          {gone && <Badge tone="slate">replaced</Badge>}
                        </div>
                        <p className={`mt-1.5 break-words text-sm leading-snug ${gone ? "superseded text-slate-400" : "text-white"}`}>{factText(fact)}</p>
                        <div className="mt-1">
                          {confirming === fact.id ? (
                            <div role="group" aria-label={`Forget ${factText(fact)}?`} className="mt-1 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] p-2 text-sm motion-safe:animate-scale-in">
                              <span className="px-1.5 text-rose-50">Forget this? This can't be undone.</span>
                              <Button variant="danger" size="sm" busy={busy === fact.id} onClick={() => void forgetFact(fact)} className={TAP}>
                                Yes, forget
                              </Button>
                              <Button variant="quiet" size="sm" onClick={() => setConfirming(null)} className={TAP}>
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => setConfirming(fact.id)}
                              aria-label={`Forget ${factText(fact)}`}
                              className={`-ml-2 inline-flex ${TAP} items-center gap-1.5 rounded-full px-2 text-xs font-medium text-rose-200/90 transition-colors hover:bg-rose-500/10 hover:text-rose-100 disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`}
                            >
                              <Trash2 size={13} aria-hidden /> Forget
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )}
            <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-400">
              <Info size={13} aria-hidden className="mt-px shrink-0" />
              <span>
                Forgetting here forgets everywhere: the phone, the texts and the chat use the same memory. The chat history kept on this device is
                cleared by the chat's own control.
              </span>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

/** A small quiet chip for a memory's provenance: where it came from, when, how sure. */
function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 ring-1 ring-inset ring-white/[0.08]">
      <span aria-hidden className="text-violet-300">
        {icon}
      </span>
      {children}
    </span>
  );
}
