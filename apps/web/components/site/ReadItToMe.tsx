"use client";

import { useEffect, useState } from "react";
import type { CatalogSource } from "@/lib/catalog-client";
import type { LetterReading, SampleLetter } from "@/lib/letters";
import { useCatalog } from "@/lib/use-showcase";
import { LetterReadingCard, type Speaker } from "./LetterReadingCard";
import { ErrorNote, Note, PageIntro, buttonClass } from "./ui";

const MAX_BYTES = 8 * 1024 * 1024;

/** Read It To Me (§4.8): a photo of a letter becomes what it is, what it says, what to do by when. */
export function ReadItToMe({ source: injected, speaker }: { source?: CatalogSource; speaker?: Speaker }) {
  const { source, showcase } = useCatalog(injected);
  const [samples, setSamples] = useState<SampleLetter[]>([]);
  const [reading, setReading] = useState<LetterReading | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source.sampleLetters().then((s) => live && setSamples(s)).catch(() => live && setSamples([]));
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
    if (file.size > MAX_BYTES) return setError("That file is bigger than 8 MB. A phone photo of the letter is enough.");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const read = await source.readLetter({ image_b64: btoa(binary), filename: file.name });
      setPicked(null);
      setReading(read);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageIntro title="Read it to me">
        <p>
          An official letter, read back in plain words: what it is, what it says, whether money is owed to you or by you, what you must do
          and by when, and which clocks it starts. If Tempo is not sure of something, it asks you once before it goes on. It never moves money.
        </p>
      </PageIntro>

      <section aria-labelledby="pick-heading" className="mb-8 rounded-xl border-2 border-slate-200 bg-white p-5">
        <h2 id="pick-heading" className="text-xl font-bold">Your letter</h2>
        {showcase.active ? (
          <div className="mt-2">
            <Note>The showcase has no Gateway to read a new letter, so there is nothing to upload here. Pick one of the recorded letters below.</Note>
          </div>
        ) : (
          <div className="mt-2">
            <label htmlFor="letter-file" className="block text-lg">Take a photo of the letter, or choose one</label>
            <input
              id="letter-file"
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
              className="mt-2 block min-h-11 w-full rounded-lg border-2 border-slate-400 p-2 file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-teal-800 file:px-4 file:font-semibold file:text-white"
            />
            <p className="mt-1 text-sm text-slate-700">The photo goes to your Tempo Gateway only. It is read, and it is not kept as memory.</p>
          </div>
        )}
        {samples.length > 0 && (
          <div className="mt-5">
            <h3 className="font-semibold">Or try a sample letter</h3>
            <ul className="mt-2 flex flex-wrap gap-3">
              {samples.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => pick(s)} aria-pressed={picked === s.id} className={buttonClass(picked === s.id ? "primary" : "secondary")}>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {busy && <p role="status" className="mt-3">Reading your letter…</p>}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </section>

      {reading && (
        <LetterReadingCard
          reading={reading}
          speaker={speaker}
          onReply={(said) => source.reply({ reading, said })}
        />
      )}
    </div>
  );
}
