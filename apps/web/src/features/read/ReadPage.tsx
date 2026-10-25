// Read It To Me (plan.md §2): photograph or pick a sample letter: what it is, what it says, who
// owes what, what to do by when, the clocks it starts; say your reply, get a plain draft that adds
// no facts. Ported from the old ReadItToMe and LetterReadingCard; dark theme. The avatar reads it.
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Camera, Check, Clock, Copy, FileText, HelpCircle, PenLine, Volume2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, FOCUS, PageTitle, SectionTitle, Spinner } from "@/components/ui";
import { CatalogClient, type CatalogSource } from "@/lib/catalog-client";
import { type LetterReading, type LetterUnsure, type ReplyDraft, type SampleLetter, directionWords, draftReplyLocally, kindWords, longDate } from "@/lib/letters";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import type { PageProps } from "@/types/page";

const MAX_BYTES = 8 * 1024 * 1024;
const TEXTAREA = `w-full rounded-xl border border-white/15 bg-black/30 p-3 text-sm text-slate-100 placeholder:text-slate-500 ${FOCUS}`;
const INPUT = `rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The Gateway says `added_nothing`; the older contract said `adds_no_facts`. Both mean the promise held. */
function addsNoFacts(draft: ReplyDraft): boolean {
  return Boolean(draft.adds_no_facts ?? (draft as { added_nothing?: boolean }).added_nothing);
}

export default function ReadPage({ user, showcase, speak }: PageProps) {
  const injected = useMemo<CatalogSource>(() => (showcase ? new ShowcaseCatalog() : new CatalogClient()), [showcase]);
  const { source } = useCatalog(injected);
  const [samples, setSamples] = useState<SampleLetter[] | null>(null);
  const [reading, setReading] = useState<LetterReading | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .sampleLetters()
      .then((s) => live && setSamples(s))
      .catch(() => live && setSamples([]));
    return () => {
      live = false;
    };
  }, [source]);

  const pick = (sample: SampleLetter) => {
    setPicked(sample.id);
    setReading(sample.reading);
    setError(null);
  };

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("That file is bigger than 8 MB. A phone photo of the letter is enough.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = await source.readLetter({ image_b64: toBase64(bytes), filename: file.name, user_id: user.id, display_name: user.name });
      setPicked(null);
      setReading(read);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageTitle lede="An official letter, read back in plain words: what it is, what it says, whether money is owed to you or by you, what you must do and by when, and which clocks it starts. If Tempo is not sure of something, it asks you once. It never moves money.">
        Read It To Me
      </PageTitle>

      <Card as="section" aria-labelledby="pick-heading">
        <SectionTitle id="pick-heading">Your letter</SectionTitle>
        {showcase ? (
          <p className="text-sm text-slate-300">
            The showcase has no Gateway to read a new letter, so there is nothing to upload here. The two letters below were read by a real replay-mode Gateway and
            recorded.
          </p>
        ) : (
          <div>
            <label htmlFor="letter-file" className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <Camera size={16} className="text-indigo-300" aria-hidden /> Take a photo of the letter, or choose one
            </label>
            <input
              id="letter-file"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
              className={`mt-2 block w-full rounded-xl border border-white/15 bg-black/30 p-2 text-sm text-slate-200 file:mr-3 file:rounded-full file:border-0 file:bg-indigo-600 file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-white ${FOCUS}`}
            />
            <p className="mt-1 text-xs text-slate-400">The photo goes to your Tempo Gateway only. It is read once and never kept as memory.</p>
          </div>
        )}
        {samples === null && <Spinner label="Loading the sample letters" />}
        {samples && samples.length > 0 && (
          <div className="mt-4">
            <SectionTitle as="h3">Or try a recorded letter</SectionTitle>
            <ul className="grid gap-3 sm:grid-cols-2">
              {samples.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    aria-pressed={picked === s.id}
                    className={`flex h-full w-full flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors motion-reduce:transition-none ${FOCUS} ${picked === s.id ? "border-indigo-400 bg-indigo-950/40" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <FileText size={14} className="text-indigo-300" aria-hidden /> {s.title}
                    </span>
                    <span className="text-xs text-slate-400">{s.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div aria-live="polite" className="mt-3 text-sm">
          {busy && <Spinner label="Reading your letter" />}
          {error && (
            <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-rose-100">
              {error}
            </p>
          )}
        </div>
      </Card>

      {!reading && samples && !busy && (
        <EmptyState title="Nothing read yet" icon={<FileText size={28} aria-hidden />}>
          Pick a recorded letter{showcase ? "" : ", or photograph your own"}. The reading appears here in plain words.
        </EmptyState>
      )}

      {reading && <LetterReadingCard reading={reading} speak={speak} source={source} displayName={user.name} />}

      <p className="text-xs text-slate-500">
        Honest line: in replay mode and in the showcase, the reading of each sample letter is recorded from the Gateway. A photo of your own letter needs a Gemini
        key on the Gateway; without one, it says so instead of guessing.
      </p>
    </div>
  );
}

function LetterReadingCard({ reading, speak, source, displayName }: { reading: LetterReading; speak: (text: string) => void; source: CatalogSource; displayName: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [said, setSaid] = useState("");
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setAnswers({});
    setDraft(null);
    setSaid("");
    setError(null);
    setCopied(null);
  }, [reading]);

  const open = reading.unsure.filter((u) => !(u.key in answers));
  const direction = reading.money.direction;
  const directionTone = direction === "owed_to_you" ? "emerald" : direction === "you_owe" ? "rose" : "slate";
  const money = reading.money.amount_gbp ? `${directionWords(direction)}: £${reading.money.amount_gbp}` : directionWords(direction);
  // A corrected pay-by date replaces the one that was read; a plain "yes" keeps it.
  const corrected = answers.due_date ?? answers.by;
  const by = corrected && corrected !== "confirmed" ? corrected : reading.by;

  const reply = async () => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await source.reply({ reading, said, display_name: displayName }));
    } catch (e) {
      // The Gateway could not draft: the browser's own drafter uses the same two inputs and nothing else.
      setDraft(draftReplyLocally(reading, said, displayName));
      setError(`The Gateway couldn't draft this (${e instanceof Error ? e.message : String(e)}), so this draft was written in your browser from the same words.`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.draft);
      setCopied("Copied. Read it once more, then send it yourself.");
    } catch {
      setCopied("Couldn't copy on this browser. Select the draft and copy it yourself.");
    }
  };

  return (
    <section aria-labelledby="reading-heading" aria-live="polite" className="space-y-4" lang={reading.language}>
      <div className="flex flex-wrap items-center gap-2">
        {reading.sample ? <Badge tone="amber">Sample reading, written by hand</Badge> : <Badge tone="emerald">Recorded from the replay Gateway</Badge>}
        {reading.simulated?.length ? <Badge tone="amber">Vision replayed: {reading.simulated.join(", ")}</Badge> : null}
      </div>

      {open.length > 0 && (
        <Card as="div" role="group" aria-labelledby="unsure-heading" tone="amber">
          <SectionTitle id="unsure-heading" as="h2">
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle size={12} aria-hidden /> Before I go on, one thing I wasn't sure of
            </span>
          </SectionTitle>
          {open.map((u) => (
            <UnsureQuestion key={u.key} item={u} onAnswer={(value) => setAnswers((a) => ({ ...a, [u.key]: value }))} />
          ))}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="reading-heading" className="text-base font-semibold text-slate-100">
            {kindWords(reading.kind)} from {reading.sender}
            {reading.date ? `, dated ${longDate(reading.date)}` : ""}
          </h2>
          <Button onClick={() => speak(reading.reading_text)} icon={<Volume2 size={14} aria-hidden />}>
            Read it to me
          </Button>
        </div>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">What it says</dt>
            <dd className="mt-0.5 text-sm text-slate-100">{reading.says}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Money</dt>
            <dd className="mt-1">
              <Badge tone={directionTone} className="text-sm">
                {money}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">What you must do</dt>
            <dd className="mt-0.5 text-sm text-slate-100">
              {reading.must_do}
              {by && <strong className="block text-rose-200"> By {longDate(by)}.</strong>}
            </dd>
          </div>
          {reading.clocks.length > 0 && (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">The clocks this letter starts</dt>
              <dd className="mt-1">
                <ul className="space-y-1 text-sm text-slate-100">
                  {reading.clocks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <Clock size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
                      <span>
                        {c.label} <span className="text-slate-400">(rule {c.id})</span>: runs out on {longDate(c.expires_on)}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
        <details className="mt-4">
          <summary className={`cursor-pointer text-sm font-medium text-indigo-300 ${FOCUS}`}>The words Tempo reads aloud</summary>
          <p className="mt-2 text-sm text-slate-200">{reading.reading_text}</p>
        </details>
      </Card>

      <Card as="section" aria-labelledby="reply-heading">
        <SectionTitle id="reply-heading">
          <span className="inline-flex items-center gap-1.5">
            <PenLine size={12} aria-hidden /> Say it, Tempo writes it
          </span>
        </SectionTitle>
        <p className="text-sm text-slate-300">
          Say what you want to tell them, in your own words. Tempo turns it into a plain formal reply and adds no facts you did not give. You read it, then you send it.
        </p>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void reply();
          }}
        >
          <label htmlFor="said" className="block text-sm font-medium text-slate-200">
            What do you want to say?
          </label>
          <textarea id="said" value={said} onChange={(e) => setSaid(e.target.value)} rows={3} className={`mt-1 ${TEXTAREA}`} placeholder="I will pay on the 5th." />
          <Button type="submit" className="mt-3" disabled={!said.trim() || busy} busy={busy}>
            Draft my reply
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-xs text-amber-200">
            {error}
          </p>
        )}
        {draft && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Your reply, to check before you send it</h3>
              <Button variant="quiet" size="sm" onClick={() => void copy()} icon={<Copy size={14} aria-hidden />}>
                Copy
              </Button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 font-sans text-sm text-slate-100">{draft.draft}</pre>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
              {addsNoFacts(draft) ? (
                <>
                  <Check size={12} className="text-emerald-300" aria-hidden /> Made from your words and this reading only; it adds no facts you did not give.
                </>
              ) : (
                <>
                  <AlertCircle size={12} className="text-amber-300" aria-hidden /> Check every fact before sending.
                </>
              )}
            </p>
            <p role="status" className="mt-1 min-h-[1rem] text-xs text-slate-400">
              {copied}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

function UnsureQuestion({ item, onAnswer }: { item: LetterUnsure; onAnswer: (value: string) => void }) {
  const [value, setValue] = useState("");
  const isDate = /date|^by$/.test(item.key);
  return (
    <div className="mt-2">
      <p className="text-sm text-slate-100">{item.question}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button variant="ok" size="sm" onClick={() => onAnswer("confirmed")} icon={<Check size={14} aria-hidden />}>
          Yes, that's right
        </Button>
        <label className="text-xs text-slate-300">
          Or the right one
          <input type={isDate ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} className={`ml-2 ${INPUT}`} />
        </label>
        <Button variant="quiet" size="sm" disabled={!value} onClick={() => onAnswer(value)}>
          Use this
        </Button>
      </div>
    </div>
  );
}
