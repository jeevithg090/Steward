import type { Metadata } from "next";
import { A11yControls } from "@/components/site/A11yControls";
import { DOCS } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Tempo's accessibility statement and the controls: text size, plain mode, reduced motion, high contrast.",
};

const COMMITMENTS = [
  { what: "Reachable by landline and text message, not only a screen.", how: "The voice line and SMS answer the same questions as this site; a signed yes can be spoken, texted (YES) or pressed. STOP by any channel stops everything." },
  { what: "Patient turn-taking for everyone, and per-caller pace, language and voice.", how: "The Patience Profile sets language, speed and voice before the first word, from what you told Tempo: Hindi and slower, a lower voice, the question offered by text, or simply never being cut off." },
  { what: "Plain words, checked in CI.", how: "Every sentence Tempo says scores Flesch 60 or more in a test that runs on every commit. Profiles and skill manifests are held to the same bar." },
  { what: "One question at a time, with read-back.", how: "When vision is not sure of a fact, it asks one question and reads back what it heard before anything else happens." },
  { what: "Large text and plain mode on the web.", how: "The text is 12.5% larger than most sites to start with. A+ and A++ make it larger still; plain mode stacks everything in one column with bigger buttons. Both are kept in this browser only." },
  { what: "Keyboard, screen reader and reduced motion.", how: "Every page has a skip link, landmarks, a visible focus ring and live regions for state changes; axe runs in the tests. Animations and transitions switch off when your system asks for reduced motion, and contrast strengthens when it asks for more." },
  { what: "Nothing binding without a signed yes.", how: "Tempo cannot file, call, accept or pay anything until you have said yes to one specific question. Profiles can rule actions out entirely, and the Harness refuses them." },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl font-bold text-slate-900">Accessibility</h1>
      <p className="mt-3 text-lg text-slate-800">
        Tempo is built for the people the internet forgot: those who cannot read the letter, hear the call or work the app, and who are the
        ones scammers target. Being better than the agents people hear about means checkable things, listed here.
      </p>

      <section aria-labelledby="controls-heading" className="mt-8 rounded-xl border-2 border-teal-800 bg-white p-5">
        <h2 id="controls-heading" className="text-2xl font-bold text-teal-900">Make this site easier to read</h2>
        <p className="mt-1 text-slate-800">These settings are kept in this browser only. They are also at the top of every page.</p>
        <div className="mt-4">
          <A11yControls />
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-6 text-slate-800">
          <li><strong>A, A+, A++</strong>: text size.</li>
          <li><strong>Plain mode</strong>: one thing at a time, bigger buttons, more space.</li>
          <li>If your system asks for <strong>reduced motion</strong> or <strong>more contrast</strong>, this site follows it without a setting here.</li>
        </ul>
      </section>

      <section aria-labelledby="commitments-heading" className="mt-10">
        <h2 id="commitments-heading" className="text-2xl font-bold text-slate-900">What we commit to, and how</h2>
        <dl className="mt-4 space-y-5">
          {COMMITMENTS.map((c) => (
            <div key={c.what} className="rounded-xl border-2 border-slate-200 bg-white p-4">
              <dt className="text-lg font-semibold text-slate-900">{c.what}</dt>
              <dd className="mt-1 text-slate-800">{c.how}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="gaps-heading" className="mt-10">
        <h2 id="gaps-heading" className="text-2xl font-bold text-slate-900">Known gaps</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          <li>The lower voice for callers with hearing loss needs an ElevenLabs voice to be configured; until then the usual voice is used and the panel says so.</li>
          <li>Readings aloud on this site use your browser&apos;s own voices, which vary by device and language.</li>
          <li>Mission Control&apos;s plan chart is explained in words beside it, but the bars themselves are decorative.</li>
          <li>Tell us what is hard: open an issue on <a href={DOCS.accessibility} rel="noopener noreferrer" className="underline">GitHub</a>, where the full statement lives.</li>
        </ul>
      </section>
    </div>
  );
}
