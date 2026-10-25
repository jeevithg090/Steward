// Memory (plan.md §2): the Memory Card by category with source, date and trust; the timeline with
// superseded facts struck through; Forget (everywhere), Correct, Erase all. Ported from the old
// MemoryCard and re-skinned for the dark theme. Company text is evidence, never memory.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Check, Pencil, Trash2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Spinner } from "@/components/ui";
import type { MemoryCardData, MemoryItem, TemporalFact } from "@/lib/api";
import type { PageProps } from "@/types/page";

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

const INPUT = `w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 ${FOCUS}`;

export default function MemoryPage({ gateway, user, showcase, events }: PageProps) {
  const [card, setCard] = useState<MemoryCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [erasing, setErasing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCard(await gateway.memories(user.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    setNote(null);
    try {
      await action();
      setNote(said);
      await load();
    } catch (e) {
      setNote(`That didn't work: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const forget = (item: MemoryItem) => run(item.id, () => gateway.forgetMemory(user.id, item.id), `Forgotten: “${item.text}”. Gone from every device and every door.`);
  const forgetFact = (fact: TemporalFact) =>
    run(fact.id, () => gateway.forgetEpisode(user.id, fact.episode_id), `Forgotten: ${factText(fact)}.`);
  const correct = (item: MemoryItem, text: string) =>
    run(item.id, () => gateway.correctMemory(user.id, item.id, text), `Corrected. The earlier words stay visible, struck through, so you can see what changed.`);

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

  return (
    <div className="space-y-6">
      <PageTitle
        lede="What Tempo remembers about you, where each thing came from, and when. Forget any of it; the next call forgets it too."
        right={
          total > 0 || (card?.timeline.length ?? 0) > 0 ? (
            erasing ? (
              <div role="group" aria-label="Erase everything?" className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-950/20 p-2 text-sm">
                <span className="px-1 text-rose-100">Erase everything Tempo remembers?</span>
                <Button variant="danger" size="sm" busy={busy === "erase-all"} onClick={() => void eraseAll()} icon={<Trash2 size={14} aria-hidden />}>
                  Yes, erase all
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setErasing(false)} icon={<X size={14} aria-hidden />}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setErasing(true)} disabled={busy !== null} icon={<Trash2 size={14} aria-hidden />}>
                Erase all
              </Button>
            )
          ) : null
        }
      >
        Memory
      </PageTitle>

      <Card tone="indigo" padding="tight" className="flex flex-wrap items-center gap-3 text-sm">
        <Brain size={16} className="text-indigo-300" aria-hidden />
        <p>
          <strong className="text-slate-100">The Memory Gate.</strong> Company text is evidence, never memory. Only what you said and official data can be
          remembered, and only with a date, a source and a way to forget it.
        </p>
      </Card>

      <div aria-live="polite" className="min-h-[1.25rem] text-sm text-emerald-200">
        {note}
      </div>

      {error && (
        <EmptyState title="Couldn't load the Memory Card" tone="error" action={<Button variant="quiet" size="sm" onClick={() => void load()}>Try again</Button>}>
          {error}
        </EmptyState>
      )}
      {!error && !card && <Spinner label="Loading what Tempo remembers" />}

      {card && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="memories-heading" className="space-y-5">
            <SectionTitle id="memories-heading" right={<span className="text-xs text-slate-400">{total} {total === 1 ? "memory" : "memories"}</span>}>
              The Memory Card
            </SectionTitle>
            {groups.length === 0 ? (
              <EmptyState title="Nothing yet" icon={<Brain size={28} aria-hidden />}>
                Tempo only remembers what you tell it.{showcase ? " In the showcase, Margaret's recorded memories appear here until you forget them." : ""}
              </EmptyState>
            ) : (
              groups.map(([category, entries]) => (
                <Card key={category} as="section" aria-labelledby={`cat-${category}`}>
                  <SectionTitle id={`cat-${category}`} as="h3">
                    {categoryWords(category)}
                  </SectionTitle>
                  {CATEGORY_NOTES[category] && <p className="mb-3 text-xs text-slate-400">{CATEGORY_NOTES[category]}</p>}
                  <ul className="space-y-3">
                    {entries.map(({ item, earlier }) => (
                      <li key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
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
                            <input id={`edit-${item.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${INPUT} flex-1`} autoFocus />
                            <Button type="submit" variant="ok" size="sm" disabled={!draft.trim()} icon={<Check size={14} aria-hidden />}>
                              Save
                            </Button>
                            <Button variant="quiet" size="sm" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <p className="text-sm font-medium text-slate-100">{item.text}</p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                          <span>{sourceWords(item.source)}</span>
                          <span aria-hidden>·</span>
                          <span>{day(item.observed_at)}</span>
                          <span aria-hidden>·</span>
                          <span>{Math.round(item.confidence * 100)}% sure</span>
                          {item.expires_at && (
                            <>
                              <span aria-hidden>·</span>
                              <span>kept until {day(item.expires_at)}</span>
                            </>
                          )}
                          {item.trust === "trusted" ? (
                            <Badge tone="emerald">trusted</Badge>
                          ) : (
                            <Badge tone="amber" title="Untrusted text can be looked at, never acted on">evidence only</Badge>
                          )}
                        </p>
                        {earlier.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Earlier</p>
                            <ul aria-label="Earlier versions" className="mt-1 space-y-0.5 text-xs text-slate-400">
                              {earlier.map((e, i) => (
                                <li key={`${e.id}-${i}`}>
                                  <s className="superseded">{e.text}</s> <span>(replaced {day((earlier[i + 1] ?? item).observed_at)})</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {confirming === item.id ? (
                            <div role="group" aria-label={`Forget ${item.text}?`} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-rose-200">Forget this everywhere?</span>
                              <Button variant="danger" size="sm" busy={busy === item.id} onClick={() => void forget(item)}>
                                Yes, forget
                              </Button>
                              <Button variant="quiet" size="sm" onClick={() => setConfirming(null)}>
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button
                                variant="quiet"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => {
                                  setEditing(item.id);
                                  setDraft(item.text);
                                }}
                                icon={<Pencil size={14} aria-hidden />}
                                aria-label={`Correct ${item.text}`}
                              >
                                Correct
                              </Button>
                              <Button
                                variant="quiet"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => setConfirming(item.id)}
                                icon={<Trash2 size={14} aria-hidden />}
                                aria-label={`Forget ${item.text}`}
                                className="text-rose-200"
                              >
                                Forget
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))
            )}
          </section>

          <section aria-labelledby="timeline-heading" className="space-y-3">
            <SectionTitle id="timeline-heading">The timeline</SectionTitle>
            {card.timeline.length === 0 ? (
              <EmptyState title="No dated facts yet">Appointments and promises with a date land here, and stay visible when they change.</EmptyState>
            ) : (
              <Card as="div" padding="tight">
                <ol aria-label="Timeline" className="divide-y divide-white/10">
                  {card.timeline.map((fact) => {
                    const gone = Boolean(fact.valid_to || fact.superseded_by);
                    return (
                      <li key={fact.id} className="py-3 first:pt-1 last:pb-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={gone ? "slate" : "indigo"}>{KIND_WORDS[fact.kind] ?? fact.kind.replaceAll("_", " ")}</Badge>
                          {gone && <Badge tone="slate">replaced</Badge>}
                        </div>
                        <p className={`mt-1 text-sm text-slate-100 ${gone ? "superseded" : ""}`}>{factText(fact)}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {day(fact.valid_from)} → {fact.valid_to ? day(fact.valid_to) : "still true"}
                        </p>
                        <div className="mt-2">
                          {confirming === fact.id ? (
                            <div role="group" aria-label={`Forget ${factText(fact)}?`} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-rose-200">Forget this?</span>
                              <Button variant="danger" size="sm" busy={busy === fact.id} onClick={() => void forgetFact(fact)}>
                                Yes, forget
                              </Button>
                              <Button variant="quiet" size="sm" onClick={() => setConfirming(null)}>
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <Button variant="quiet" size="sm" disabled={busy !== null} onClick={() => setConfirming(fact.id)} aria-label={`Forget ${factText(fact)}`} className="text-rose-200" icon={<Trash2 size={14} aria-hidden />}>
                              Forget
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )}
            <p className="text-xs text-slate-500">
              Forgetting here forgets everywhere: the phone, the texts and the chat use the same memory. The chat history kept on this device is
              cleared by the chat's own control.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
