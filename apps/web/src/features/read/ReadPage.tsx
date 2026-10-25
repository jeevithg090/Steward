// Read It To Me (plan.md §2, §12.1 finding 8): photograph a letter, or try one of two sample
// photos, and hear what it is, what it says, who owes what, what to do by when and the clocks it
// starts; then say your reply and get a plain draft that adds no facts. A sample photo takes the
// same path as your own: fetched, base64-encoded and posted to the Gateway's vision step
// (`POST /letters/read`), where replay mode recognises it by its SHA-256. In the showcase the
// recorded reading stands in for that step (samples.ts). The avatar reads the result aloud.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertCircle,
  CalendarClock,
  Camera,
  CameraOff,
  Check,
  Clock,
  Copy,
  Droplets,
  FileText,
  HelpCircle,
  Info,
  Landmark,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageSquareQuote,
  PenLine,
  PoundSterling,
  ScanText,
  Upload,
  Volume2,
} from "lucide-react";
import { Badge, type BadgeTone, Button, Card, EmptyState, FOCUS, SectionTitle, PageTitle, Skeleton, toast } from "@/components/ui";
import { CatalogClient, type CatalogSource, GatewayError } from "@/lib/catalog-client";
import { type LetterReading, type LetterUnsure, type ReplyDraft, directionWords, draftReplyLocally, kindWords, longDate } from "@/lib/letters";
import { ShowcaseCatalog } from "@/lib/showcase";
import { useCatalog } from "@/lib/use-showcase";
import type { PageProps } from "@/types/page";
import { TAP } from "../story/demo";
import { SAMPLE_PHOTOS, type SamplePhoto, photoUrl, samplePhotoBody, toBase64, withRecordedVision } from "./samples";

const MAX_BYTES = 8 * 1024 * 1024;
/** Glass fields with a violet glow on focus (the glow is the focus ring here, so it is strong). */
const FIELD = "rounded-2xl border border-white/10 bg-white/[0.03] text-slate-100 transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-slate-500 hover:border-white/20 focus:border-accent-300 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-accent-500/25 focus-visible:outline-none motion-reduce:transition-none [color-scheme:dark]";
const TEXTAREA = `${FIELD} w-full p-4 text-[15px] leading-relaxed`;
const INPUT = `${FIELD} min-h-[44px] px-3 py-2 text-sm`;
const DT = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400";

/** How each sample looks on its card: an icon, and which way the money goes. */
const SAMPLE_LOOK: Record<string, { Icon: LucideIcon; tone: BadgeTone; words: string; tile: string }> = {
  "thames-water-overpayment": { Icon: Droplets, tone: "gold", words: "Owed to you", tile: "from-gold-300 to-gold-500 text-ink" },
  "council-tax-reminder": { Icon: Landmark, tone: "amber", words: "You owe", tile: "from-amber-300 to-amber-500 text-ink" },
};

/** The money's look by direction: gold when it comes to you, amber when you owe it. */
const MONEY_LOOK: Record<string, { box: string; amount: string; words: string; icon: string }> = {
  owed_to_you: { box: "border-gold-400/30 bg-gradient-to-b from-gold-400/[0.12] to-gold-400/[0.03]", amount: "text-gold", words: "text-gold-200", icon: "text-gold-300" },
  you_owe: { box: "border-amber-400/30 bg-gradient-to-b from-amber-500/[0.12] to-amber-500/[0.03]", amount: "text-white", words: "text-amber-100", icon: "text-amber-300" },
  none: { box: "border-white/[0.08] bg-white/[0.025]", amount: "text-white", words: "text-slate-200", icon: "text-slate-400" },
};

/** "Thames Water" → "TW", for the sender's tile. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?").slice(0, 2);
}

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
  const [dragging, setDragging] = useState(false);
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
    <div className="space-y-6">
      <PageTitle lede="An official letter, read back in plain words: what it is, what it says, whether money is owed to you or by you, what you must do and by when, and which clocks it starts. If Tempo is not sure of something, it asks you once. It never moves money.">
        Read It To Me
      </PageTitle>

      <Card as="section" aria-labelledby="pick-heading" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-accent-600/15 blur-3xl" />
        <h2 id="pick-heading" className="relative flex items-center gap-3 text-lg font-semibold tracking-[-0.01em] text-white">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/30 to-accent-700/10 text-accent-100 ring-1 ring-inset ring-accent-300/25">
            <FileText size={19} strokeWidth={1.85} />
          </span>
          Your letter
        </h2>
        <div className="relative mt-5">
          {showcase ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/[0.12] bg-white/[0.015] px-6 py-8 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.06] text-slate-300 ring-1 ring-inset ring-white/10">
                <CameraOff size={22} strokeWidth={1.75} />
              </span>
              <p className="max-w-xl text-sm leading-relaxed text-slate-300">
                The showcase has no Gateway to read a new letter, so there is nothing to upload here. The two sample photos below get the reading a real replay-mode Gateway
                gave for them.
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="letter-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragging) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && busy === null) upload(file);
                }}
                className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-300 motion-reduce:transition-none ${
                  dragging ? "border-accent-300 bg-accent-500/[0.14]" : "border-accent-400/35 bg-accent-500/[0.04] hover:border-accent-300/60 hover:bg-accent-500/[0.08]"
                } ${busy ? "pointer-events-none opacity-60" : ""}`}
              >
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-accent-500 to-accent-700 text-white shadow-glow transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none">
                  {busy === "photo" ? <Loader2 size={24} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Camera size={24} aria-hidden />}
                </span>
                <span className="block text-base font-semibold text-white">Take a photo of the letter, or choose one</span>
                <span className="block max-w-md text-sm text-slate-400">It goes to your Tempo Gateway only, is read once, and is never kept as memory.</span>
                <span aria-hidden className="mt-1 hidden items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-xs text-slate-300 ring-1 ring-inset ring-white/10 sm:inline-flex">
                  <Upload size={12} /> or drop an image here
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
              <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-slate-400">
                <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  Your own photo needs a Gemini key on the Gateway{replayVision ? ", and this one is in replay mode, so it will say it can't read it" : ""}. The sample photos
                  below work without one.
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="relative mt-8">
          <SectionTitle as="h3">Try it with a sample photo</SectionTitle>
          <ul className="grid gap-4 sm:grid-cols-2">
            {SAMPLE_PHOTOS.map((photo) => {
              const active = picked === photo.id;
              const loading = busy === photo.id;
              const look = SAMPLE_LOOK[photo.id] ?? { Icon: FileText, tone: "slate" as BadgeTone, words: "", tile: "from-slate-300 to-slate-500 text-ink" };
              return (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => void readSample(photo)}
                    disabled={busy !== null}
                    aria-pressed={active}
                    aria-describedby="sample-note"
                    className={`group flex h-full w-full flex-col overflow-hidden rounded-3xl border bg-gradient-to-b from-white/[0.05] to-white/[0.015] text-left transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-wait disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${FOCUS} ${
                      active ? "border-accent-400/60 shadow-glow" : "border-white/[0.08] shadow-glass hover:border-accent-300/35"
                    }`}
                  >
                    <span className="relative block h-44 w-full overflow-hidden bg-white">
                      <img src={photoUrl(photo)} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
                      <span aria-hidden className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-ink-900 via-ink-900/85 to-transparent" />
                      {loading && (
                        <span className="absolute inset-0 flex items-center justify-center bg-ink/60 backdrop-blur-[2px]">
                          <Loader2 size={30} className="animate-spin text-white motion-reduce:animate-none" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="relative -mt-8 flex flex-1 flex-col px-5 pb-5">
                      <span aria-hidden className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-b shadow-[0_10px_24px_-10px_rgb(0_0_0/0.8)] ring-4 ring-ink-900 ${look.tile}`}>
                        <look.Icon size={22} strokeWidth={2} />
                      </span>
                      <span className="mt-3 text-[15px] font-semibold text-white">{photo.title}</span>
                      <span className="mt-1 text-sm leading-relaxed text-slate-400">{photo.description}</span>
                      <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                        {look.words ? (
                          <Badge tone={look.tone} dot>
                            {look.words}
                          </Badge>
                        ) : (
                          <span />
                        )}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white transition-colors motion-reduce:transition-none ${
                            active ? "bg-white/10 ring-1 ring-inset ring-white/15" : "bg-gradient-to-b from-accent-600 to-accent-700 shadow-[0_8px_20px_-10px_rgb(var(--accent-600)/0.9)] group-hover:from-accent-500"
                          }`}
                        >
                          <ScanText size={14} aria-hidden /> {loading ? "Reading…" : active ? "Read it again" : "Read this photo"}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p id="sample-note" className="mt-3 text-[13px] leading-relaxed text-slate-400">
            {showcase
              ? "The photo is checked by its fingerprint, the way the Gateway's replay vision does, and gets the reading recorded from it."
              : "The photo is sent to your Gateway exactly as your own would be. In replay mode its vision step recognises these two photos by their fingerprint; with a Gemini key it reads them for real."}
          </p>
        </div>

        <div aria-live="polite" className="relative text-sm">
          {busy && <p className="sr-only">Reading your letter</p>}
          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] px-4 py-3 text-rose-50">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-300" aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </div>
      </Card>

      {!reading && busy && (
        <div aria-hidden className="surface overflow-hidden rounded-3xl">
          <div className="h-1 bg-gradient-to-r from-accent-500/60 via-accent-400/40 to-gold-400/40" />
          <div className="space-y-4 p-6 sm:p-8">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-6 w-2/3" />
            </div>
            <Skeleton className="h-4 w-full" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
            </div>
          </div>
        </div>
      )}

      {!reading && !busy && (
        <EmptyState title="Nothing read yet" icon={<FileText size={22} aria-hidden />}>
          Press a sample photo{showcase ? "" : ", or photograph your own letter"}. The reading appears here in plain words, and Tempo reads it aloud.
        </EmptyState>
      )}

      {reading && origin && (
        <LetterReadingCard reading={reading} speak={speak} source={source} displayName={user.name} headingRef={readingRef} provenance={<Provenance origin={origin} reading={reading} />} />
      )}

      <Card tone="amber" padding="tight" className="flex items-start gap-3 !px-5 !py-4">
        <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
        <p className="text-[13px] leading-relaxed text-amber-50">
          Honest line: in replay mode, the Gateway's vision step answers for the two sample photos with the facts recorded for them, and the Gateway builds the
          reading from those facts with its own rules. In the showcase, the reading a replay Gateway gave is shown without a Gateway. A photo of your own letter needs a
          Gemini key on the Gateway; without one, it says so instead of guessing.
        </p>
      </Card>
    </div>
  );
}

function Provenance({ origin, reading }: { origin: Origin; reading: LetterReading }) {
  const badges: ReactNode[] = [];
  if (reading.sample) badges.push(<Badge key="s" tone="amber" dot>Sample reading, written by hand</Badge>);
  else if (origin.showcase) badges.push(<Badge key="r" tone="amber" dot>Recorded from the replay Gateway</Badge>);
  else badges.push(<Badge key="g" tone="emerald" dot>Read by your Gateway</Badge>);
  if (!origin.showcase && origin.replayVision) badges.push(<Badge key="v" tone="amber" className="!whitespace-normal">Vision replayed: the photo was recognised by its fingerprint</Badge>);
  if (reading.simulated?.length) badges.push(<Badge key="sim" tone="amber" className="!whitespace-normal">Replayed: {reading.simulated.join(", ")}</Badge>);
  if (origin.kind === "sample") badges.push(<Badge key="k" tone="slate">sample photo</Badge>);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
      <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        <ScanText size={12} aria-hidden /> How this was read
      </span>
      {badges}
    </div>
  );
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
  const look = MONEY_LOOK[direction] ?? MONEY_LOOK.none!;
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
    <section aria-labelledby="reading-heading" aria-live="polite" className="scroll-mt-4 space-y-4 motion-safe:animate-fade-up" lang={reading.language}>
      {provenance}

      {open.length > 0 && (
        <Card as="div" role="group" aria-labelledby="unsure-heading" tone="amber" className="relative overflow-hidden">
          <SectionTitle id="unsure-heading" as="h2">
            <span className="inline-flex items-center gap-1.5 text-amber-200">
              <HelpCircle size={13} aria-hidden /> Before I go on, one thing I wasn't sure of
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

      <Card padding="none" className="relative overflow-hidden">
        <div aria-hidden className="h-1 bg-gradient-to-r from-accent-500 via-accent-400 to-gold-400" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-0 h-56 w-56 rounded-full bg-accent-600/10 blur-3xl" />
        <div className="relative p-5 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-slate-100 to-slate-300 text-sm font-bold tracking-wide text-ink shadow-[0_10px_24px_-12px_rgb(0_0_0/0.9)]">
                {initials(reading.sender)}
              </span>
              <h2 id="reading-heading" ref={headingRef} tabIndex={-1} className="min-w-0 font-display text-[1.7rem] leading-[1.12] text-white focus:outline-none sm:text-[2.1rem]">
                {kindWords(reading.kind)} from {reading.sender}
                {reading.date ? `, dated ${longDate(reading.date)}` : ""}
              </h2>
            </div>
            <Button onClick={() => speak(reading.reading_text)} icon={<Volume2 size={16} aria-hidden />} className={`${TAP} w-full sm:w-auto`}>
              Read it to me
            </Button>
          </div>

          <dl className="mt-7 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:col-span-2 sm:p-5">
              <dt className={DT}>
                <FileText size={12} aria-hidden /> What it says
              </dt>
              <dd className="mt-2 text-[17px] leading-relaxed text-white">{reading.says}</dd>
            </div>
            <div className={`rounded-2xl border p-4 sm:p-5 ${look.box}`}>
              <dt className={DT}>
                <PoundSterling size={12} aria-hidden className={look.icon} /> Money
              </dt>
              <dd className="mt-2">
                {reading.money.amount_gbp && (
                  <span aria-hidden className={`num block font-display text-[2.9rem] leading-none ${look.amount}`}>
                    £{reading.money.amount_gbp}
                  </span>
                )}
                <span className={`mt-2.5 block text-[15px] font-medium ${look.words}`}>{money}</span>
              </dd>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5">
              <dt className={DT}>
                <ListChecks size={12} aria-hidden /> What you must do
              </dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-slate-100">
                <p>{reading.must_do}</p>
                {by && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-500/[0.12] px-3 py-1.5 text-amber-100 ring-1 ring-inset ring-amber-400/30">
                    <CalendarClock size={15} aria-hidden className="shrink-0 text-amber-300" />
                    <strong className="font-semibold">By {longDate(by)}.</strong>
                  </p>
                )}
              </dd>
            </div>
            {reading.clocks.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:col-span-2 sm:p-5">
                <dt className={DT}>
                  <Clock size={12} aria-hidden /> The clocks this letter starts
                </dt>
                <dd className="mt-3">
                  <ul className="space-y-2 text-sm text-slate-100">
                    {reading.clocks.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/[0.03] px-3 py-2.5">
                        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25">
                          <Clock size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          {c.label} <span className="font-mono text-xs text-slate-400">(rule {c.id})</span>
                        </span>
                        <span className="num text-[13px] text-amber-100">runs out on {longDate(c.expires_on)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-3 rounded-2xl border-l-[3px] border-accent-400/70 bg-accent-500/[0.06] py-4 pl-5 pr-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-200">
              <MessageSquareQuote size={12} aria-hidden /> The words Tempo reads aloud
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-200">{reading.reading_text}</p>
          </div>
        </div>
      </Card>

      <Card as="section" aria-labelledby="reply-heading">
        <h2 id="reply-heading" className="flex items-center gap-3 text-lg font-semibold tracking-[-0.01em] text-white">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/30 to-accent-700/10 text-accent-100 ring-1 ring-inset ring-accent-300/25">
            <PenLine size={18} strokeWidth={1.85} />
          </span>
          Say it, Tempo writes it
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
          Say what you want to tell them, in your own words. Tempo turns it into a plain formal reply and adds no facts you did not give. You read it, then you send it.
        </p>
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void reply();
          }}
        >
          <label htmlFor="said" className="block text-sm font-medium text-slate-200">
            What do you want to say?
          </label>
          <textarea id="said" value={said} onChange={(e) => setSaid(e.target.value)} rows={3} className={`mt-2 ${TEXTAREA}`} placeholder="I will pay on the 5th." />
          <Button type="submit" className={`mt-3 ${TAP}`} disabled={!said.trim() || busy} busy={busy} icon={<PenLine size={15} aria-hidden />}>
            Draft my reply
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-[13px] text-amber-100">
            <AlertCircle size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
            <span>{error}</span>
          </p>
        )}
        {draft && (
          <div className="mt-6 motion-safe:animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-white">Your reply, to check before you send it</h3>
              <Button variant="quiet" onClick={() => void copy()} icon={<Copy size={14} aria-hidden />} className={TAP}>
                Copy
              </Button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-gradient-to-b from-[#fbf8f1] to-[#f1ece1] p-5 font-sans text-[15px] leading-relaxed text-slate-900 shadow-[0_24px_50px_-28px_rgb(0_0_0/0.9)] ring-1 ring-inset ring-black/5 sm:p-6">
              {draft.draft}
            </pre>
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-slate-300">
              {addsNoFacts(draft) ? (
                <>
                  <Check size={14} className="shrink-0 text-emerald-300" aria-hidden /> Made from your words and this reading only; it adds no facts you did not give.
                </>
              ) : (
                <>
                  <AlertCircle size={14} className="shrink-0 text-amber-300" aria-hidden /> Check every fact before sending.
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
    <div className="mt-1">
      <p className="text-lg leading-snug text-white">{item.question}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Button variant="ok" onClick={() => onAnswer("confirmed")} icon={<Check size={15} aria-hidden />} className={TAP}>
          Yes, that's right
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={id} className="block text-xs font-medium text-amber-100">
            Or the right one
            <input id={id} type={isDate ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} className={`mt-1.5 block ${INPUT}`} />
          </label>
          <Button variant="quiet" disabled={!value} onClick={() => onAnswer(value)} className={TAP}>
            Use this
          </Button>
        </div>
      </div>
    </div>
  );
}
