// Read It To Me (plan.md §2, §12.1 finding 8): photograph a letter, or try one of two sample
// photos, and hear what it is, what it says, who owes what, what to do by when and the clocks it
// starts; then say your reply and get a plain draft that adds no facts. A sample photo takes the
// same path as your own: fetched, base64-encoded and posted to the Gateway's vision step
// (`POST /letters/read`), where replay mode recognises it by its SHA-256. In the showcase the
// recorded reading stands in for that step (samples.ts). The avatar reads the result aloud.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AlertCircle, Camera, Check, Clock, Copy, FileText, HelpCircle, Loader2, PenLine, ScanText, Volume2 } from "lucide-react";
import { Badge, Button, Card, FOCUS, PageTitle, SectionTitle, toast } from "@/components/ui";
import { CatalogClient, type CatalogSource, GatewayError } from "@/lib/catalog-client";
import { type LetterReading, type LetterUnsure, type ReplyDraft, directionWords, draftReplyLocally, kindWords, longDate } from "@/lib/letters";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";
import { SAMPLE_PHOTOS, type SamplePhoto, photoUrl, samplePhotoBody, toBase64, withRecordedVision } from "./samples";

const MAX_BYTES = 8 * 1024 * 1024;
const TEXTAREA = `w-full rounded-xl border border-white/15 bg-black/30 p-3 text-sm text-slate-100 placeholder:text-slate-500 ${FOCUS}`;
const INPUT = `min-h-[44px] rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

/** Where the reading on screen came from, said plainly on a badge. */
type Origin = { kind: "sample" | "photo"; showcase: boolean; replayVision: boolean };

/** The Gateway says `added_nothing`; the older contract said `adds_no_facts`. Both mean the promise held. */
function addsNoFacts(draft: ReplyDraft): boolean {
  return Boolean(draft.adds_no_facts ?? (draft as { added_nothing?: boolean }).added_nothing);
}

/** A failure in plain words, with what to do next. */
export function readFailure(e: unknown, showcase: boolean): string {
  if (e instanceof GatewayError) {
    if (e.status === 401 || e.status === 403) return "Your Tempo Gateway didn't accept this browser's token. Check the token in Settings, then try again.";
    if (e.status === 413) return `${e.message} A phone photo of the letter is enough.`;
    if (e.status === 422 || e.status === 503) return `${e.message} The two sample photos below always work.`;
    return `${e.message} Try again in a moment, or try a sample photo.`;
  }
  if (e instanceof TypeError) return "Can't reach your Tempo Gateway. Check it is running and its address in Settings, or switch on the showcase there.";
  const text = e instanceof Error ? e.message : String(e);
  return showcase ? text : `${text} Try one of the sample photos below.`;
}

export default function ReadPage({ user, showcase, speak, health }: PageProps) {
  const injected = useMemo<CatalogSource>(() => (showcase ? new ShowcaseCatalog() : new CatalogClient()), [showcase]);
  const { source: catalog } = useCatalog(injected);
  const source = useMemo(() => withRecordedVision(catalog), [catalog]);
  const [reading, setReading] = useState<LetterReading | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readingRef = useRef<HTMLHeadingElement>(null);
  const replayVision = Boolean(health?.simulated.includes("vision"));

  // A new reading: move to it, and read it aloud (that is what the page is for).
  useEffect(() => {
    if (!reading) return;
    const heading = readingRef.current;
    heading?.focus({ preventScroll: true });
    // Scroll to the top of the reading (the read-back question comes before the heading).
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (heading?.closest("section") ?? heading)?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [reading]);

  const read = async (key: string, kind: Origin["kind"], body: () => Promise<Parameters<CatalogSource["readLetter"]>[0]>) => {
    setBusy(key);
    setError(null);
    try {
      const result = await source.readLetter(await body());
      setPicked(kind === "sample" ? key : null);
      setOrigin({ kind, showcase: source.showcase, replayVision });
      setReading(result);
      speak(result.reading_text);
    } catch (e) {
      setError(readFailure(e, source.showcase));
    } finally {
      setBusy(null);
    }
  };

  const readSample = (photo: SamplePhoto) => read(photo.id, "sample", () => samplePhotoBody(photo, user));

  const upload = (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("That file is bigger than 8 MB. A phone photo of the letter is enough.");
      return;
    }
    void read("photo", "photo", async () => ({
      image_b64: toBase64(new Uint8Array(await file.arrayBuffer())),
      filename: file.name,
      user_id: user.id,
      display_name: user.name,
    }));
  };

  return (
    <div className="space-y-5">
      <PageTitle lede="An official letter, read back in plain words: what it is, what it says, whether money is owed to you or by you, what you must do and by when, and which clocks it starts. If Tempo is not sure of something, it asks you once. It never moves money.">
        Read It To Me
      </PageTitle>

      <Card as="section" aria-labelledby="pick-heading" className="space-y-4">
        <SectionTitle id="pick-heading">Your letter</SectionTitle>
        {showcase ? (
          <p className="text-sm text-slate-300">
            The showcase has no Gateway to read a new letter, so there is nothing to upload here. The two sample photos below get the reading a real replay-mode Gateway
            gave for them.
          </p>
        ) : (
          <div>
            <label
              htmlFor="letter-file"
              className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-2xl border border-dashed border-indigo-400/50 bg-indigo-950/20 p-4 text-sm text-slate-100 transition-colors hover:bg-indigo-950/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white motion-reduce:transition-none ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                {busy === "photo" ? <Loader2 size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Camera size={20} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Take a photo of the letter, or choose one</span>
                <span className="block text-xs text-slate-400">It goes to your Tempo Gateway only, is read once, and is never kept as memory.</span>
              </span>
              <input
                id="letter-file"
                type="file"
                accept="image/*"
                disabled={busy !== null}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) upload(file);
                }}
              />
            </label>
            <p className="mt-2 text-xs text-slate-400">
              Your own photo needs a Gemini key on the Gateway{replayVision ? ", and this one is in replay mode, so it will say it can't read it" : ""}. The sample photos
              below work without one.
            </p>
          </div>
        )}

        <div>
          <SectionTitle as="h3">Try it with a sample photo</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SAMPLE_PHOTOS.map((photo) => {
              const active = picked === photo.id;
              const loading = busy === photo.id;
              return (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => void readSample(photo)}
                    disabled={busy !== null}
                    aria-pressed={active}
                    aria-describedby="sample-note"
                    className={`group flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition-colors disabled:cursor-wait motion-reduce:transition-none ${FOCUS} ${active ? "border-indigo-400 bg-indigo-950/40" : "border-white/10 bg-black/20 hover:border-indigo-400/50 hover:bg-white/5"}`}
                  >
                    <span className="relative block h-36 w-full overflow-hidden bg-white">
                      <img src={photoUrl(photo)} alt="" loading="lazy" className="h-full w-full object-cover object-top opacity-90 transition-opacity group-hover:opacity-100" />
                      {loading && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 size={28} className="animate-spin text-white motion-reduce:animate-none" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1 p-3">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                        <FileText size={14} className="shrink-0 text-indigo-300" aria-hidden /> {photo.title}
                      </span>
                      <span className="text-xs text-slate-400">{photo.description}</span>
                      <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">
                        <ScanText size={14} aria-hidden /> {loading ? "Reading…" : active ? "Read it again" : "Read this photo"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p id="sample-note" className="mt-2 text-xs text-slate-400">
            {showcase
              ? "The photo is checked by its fingerprint, the way the Gateway's replay vision does, and gets the reading recorded from it."
              : "The photo is sent to your Gateway exactly as your own would be. In replay mode its vision step recognises these two photos by their fingerprint; with a Gemini key it reads them for real."}
          </p>
        </div>

        <div aria-live="polite" className="text-sm">
          {busy && <p className="sr-only">Reading your letter</p>}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-rose-50">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-300" aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </div>
      </Card>

      {!reading && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 px-6 py-8 text-center text-slate-400">
          <FileText size={28} aria-hidden className="text-slate-500" />
          <p className="text-sm font-medium text-slate-200">Nothing read yet</p>
          <p className="max-w-md text-xs">Press a sample photo{showcase ? "" : ", or photograph your own letter"}. The reading appears here in plain words, and Tempo reads it aloud.</p>
        </div>
      )}

      {reading && origin && (
        <LetterReadingCard reading={reading} speak={speak} source={source} displayName={user.name} headingRef={readingRef} provenance={<Provenance origin={origin} reading={reading} />} />
      )}

      <p className="text-xs text-slate-400">
        Honest line: in replay mode, the Gateway's vision step answers for the two sample photos with the facts recorded for them, and the Gateway builds the
        reading from those facts with its own rules. In the showcase, the reading a replay Gateway gave is shown without a Gateway. A photo of your own letter needs a
        Gemini key on the Gateway; without one, it says so instead of guessing.
      </p>
    </div>
  );
}

function Provenance({ origin, reading }: { origin: Origin; reading: LetterReading }) {
  const badges: ReactNode[] = [];
  if (reading.sample) badges.push(<Badge key="s" tone="amber">Sample reading, written by hand</Badge>);
  else if (origin.showcase) badges.push(<Badge key="r" tone="amber">Recorded from the replay Gateway</Badge>);
  else badges.push(<Badge key="g" tone="emerald">Read by your Gateway</Badge>);
  if (!origin.showcase && origin.replayVision) badges.push(<Badge key="v" tone="amber">Vision replayed: the photo was recognised by its fingerprint</Badge>);
  if (reading.simulated?.length) badges.push(<Badge key="sim" tone="amber">Replayed: {reading.simulated.join(", ")}</Badge>);
  if (origin.kind === "sample") badges.push(<Badge key="k" tone="slate">sample photo</Badge>);
  return <div className="flex flex-wrap items-center gap-2">{badges}</div>;
}

function LetterReadingCard({
  reading,
  speak,
  source,
  displayName,
  headingRef,
  provenance,
}: {
  reading: LetterReading;
  speak: (text: string) => void;
  source: CatalogSource;
  displayName: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  provenance: ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [said, setSaid] = useState("");
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnswers({});
    setDraft(null);
    setSaid("");
    setError(null);
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
      toast.success("Copied. Read it once more, then send it yourself.");
    } catch {
      toast.error("This browser wouldn't let Tempo copy. Select the draft and copy it yourself.");
    }
  };

  return (
    <section aria-labelledby="reading-heading" aria-live="polite" className="scroll-mt-4 space-y-4" lang={reading.language}>
      {provenance}

      {open.length > 0 && (
        <Card as="div" role="group" aria-labelledby="unsure-heading" tone="amber">
          <SectionTitle id="unsure-heading" as="h2">
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle size={12} aria-hidden /> Before I go on, one thing I wasn't sure of
            </span>
          </SectionTitle>
          {open.map((u) => (
            <UnsureQuestion
              key={u.key}
              item={u}
              onAnswer={(value) => {
                setAnswers((a) => ({ ...a, [u.key]: value }));
                toast.success(value === "confirmed" ? "Thank you. Tempo keeps that date." : `Thank you. Tempo now uses ${longDate(value)}.`);
              }}
            />
          ))}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="reading-heading" ref={headingRef} tabIndex={-1} className="min-w-0 text-lg font-semibold text-slate-100 focus:outline-none">
            {kindWords(reading.kind)} from {reading.sender}
            {reading.date ? `, dated ${longDate(reading.date)}` : ""}
          </h2>
          <Button onClick={() => speak(reading.reading_text)} icon={<Volume2 size={16} aria-hidden />} className={TAP}>
            Read it to me
          </Button>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">What it says</dt>
            <dd className="mt-0.5 text-base text-slate-100">{reading.says}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Money</dt>
            <dd className="mt-1">
              <Badge tone={directionTone} className="px-3 py-1 text-sm">
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
            <div className="sm:col-span-2">
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
          <summary className={`inline-flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-indigo-300 ${FOCUS}`}>The words Tempo reads aloud</summary>
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
          <Button type="submit" className={`mt-3 ${TAP}`} disabled={!said.trim() || busy} busy={busy}>
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
              <Button variant="quiet" onClick={() => void copy()} icon={<Copy size={14} aria-hidden />} className={TAP}>
                Copy
              </Button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/30 p-3 font-sans text-sm text-slate-100">{draft.draft}</pre>
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
          </div>
        )}
      </Card>
    </section>
  );
}

function UnsureQuestion({ item, onAnswer }: { item: LetterUnsure; onAnswer: (value: string) => void }) {
  const [value, setValue] = useState("");
  const isDate = /date|^by$/.test(item.key);
  const id = `unsure-${item.key}`;
  return (
    <div className="mt-2">
      <p className="text-base text-slate-100">{item.question}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button variant="ok" onClick={() => onAnswer("confirmed")} icon={<Check size={14} aria-hidden />} className={TAP}>
          Yes, that's right
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={id} className="block text-xs text-slate-300">
            Or the right one
            <input id={id} type={isDate ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} className={`mt-1 block ${INPUT}`} />
          </label>
          <Button variant="quiet" disabled={!value} onClick={() => onAnswer(value)} className={TAP}>
            Use this
          </Button>
        </div>
      </div>
    </div>
  );
}
