"use client";

import Link from "next/link";
import type { Gateway } from "@/lib/api";
import { useShowcase } from "@/lib/use-showcase";
import { LiveCounters } from "./LiveCounters";
import { PairRedirect } from "./PairRedirect";
import { ButtonLink, Card, DOCS } from "./ui";

/** The story in SHIPPING.md §1, in order: one fact runs through every part of Tempo. */
export const BEATS: { name: string; sentence: string; href: string; link: string }[] = [
  { name: "Hear", sentence: "Tempo answers the way Margaret asked to be spoken to: slowly, one question at a time, waiting as long as it takes.", href: "/profiles/take-your-time", link: "See the Take Your Time profile" },
  { name: "Read", sentence: "Rail data says how late; vision reads a ticket or a card and reads back anything it is not sure of.", href: "/read", link: "Have a letter read to you" },
  { name: "Price", sentence: "The amount comes from a YAML rule pack with a citation, never from a model.", href: "/skills#clawback-uk-rail", link: "See the Delay Repay skill" },
  { name: "Check", sentence: "Three models from three providers may say no or ask a person; they can never raise the amount.", href: "/control", link: "Watch the Consensus Court vote" },
  { name: "Weigh", sentence: "Is it worth her time, at her own value of an hour?", href: "/control", link: "See the appraisal in Mission Control" },
  { name: "Time it", sentence: "Every right has a clock; sometimes the right move is to wait, with the date.", href: "/skills#rights-decay", link: "See Rights Decay" },
  { name: "Ask once", sentence: "One question, a signed yes (Face ID, SMS YES or a spoken yes); STOP stops everything.", href: "/control", link: "Answer Margaret's one question" },
  { name: "Prove it", sentence: "The company's own AI verifies Tempo's mandate in milliseconds and refuses anything outside it.", href: DOCS.security, link: "Read how the Agent Passport works" },
  { name: "Remember only her words", sentence: "Company text is evidence, never memory; everything is dated, visible and forgettable.", href: "/control", link: "Open Margaret's Memory Card" },
  { name: "Return the time", sentence: "Hours and pounds returned, counted only once the money has arrived.", href: "/control", link: "Watch the ledger tick up" },
];

/** SHIPPING.md §4.8: the same people are hit from every side at once. */
export const FORGOTTEN: { need: string; answer: string; href: string; link: string }[] = [
  {
    need: "I can't read the letter.",
    answer: "Read It To Me: take a photo and Tempo says, in your language, what it is, what it says, whether money is owed to you or by you, what to do by when, and which clocks it starts.",
    href: "/read",
    link: "Try Read It To Me",
  },
  {
    need: "I can't hear the call.",
    answer: "The Patience Profile sets language, pace and voice before the first word: lower and slower, key numbers repeated, the question sent as a text you can read as often as you like.",
    href: "/profiles/hard-of-hearing",
    link: "See Say It Again, Lower",
  },
  {
    need: "I can't work the banking app, so I'm asked to \"just send the money\".",
    answer: "Tempo never moves money. Before You Pay stands between you and the transfer: who, how much, why; the pressure signs; a cooling-off rule for a new payee; and in plain words, \"wait, and ring them on a number you already know\".",
    href: "/profiles/read-it-to-me",
    link: "See the profile that can never pay",
  },
  {
    need: "I'm the one scammers target.",
    answer: "Scam Shield checks the firm against Companies House and the FCA registers, spots pressure signs, filters suspicious texts on your phone, and warns you in your language. It never says \"safe\".",
    href: "/shield",
    link: "Check a message with Scam Shield",
  },
];

/** SHIPPING.md §10: what is honestly not done. */
export const NOT_DONE = [
  "Rule packs, clocks and benefit figures are demo values until a person checks each source.",
  "Rights Decay's curves are NYC 311 housing requests standing in for UK companies.",
  "A mandate's passkey is self-certifying; a directory or attestation issuer is roadmap.",
  "Skill Forge (narrate a skill, get a draft pack) is parked on its own branch.",
  "Live voice needs ElevenLabs keys; the Vercel showcase is recorded replay.",
];

export function Landing({ gateway }: { gateway?: Pick<Gateway, "ledger"> }) {
  const showcase = useShowcase();
  const href = (path: string) => (path.startsWith("/") ? showcase.href(path) : path);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PairRedirect />

      <section aria-labelledby="hero-heading" className="mb-12">
        <p className="text-lg font-semibold uppercase tracking-wide text-teal-800">Tempo</p>
        <h1 id="hero-heading" className="mt-2 text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
          Your time, returned.
        </h1>
        <p className="mt-4 max-w-3xl text-xl text-slate-800">
          An AI agent that wins back the money and the hours that companies owe you. Models read and plan;{" "}
          <strong>code decides money, time and permissions</strong>. It asks you once, in plain words, and never acts without your signed yes.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={href("/control")}>Watch Margaret&apos;s claim</ButtonLink>
          <ButtonLink href={href("/profiles")} kind="secondary">Pick a profile</ButtonLink>
          <ButtonLink href={href("/read")} kind="secondary">Read a letter to me</ButtonLink>
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-lg">
          <li><a href={DOCS.addUseCase} rel="noopener noreferrer" className="underline">Add your use case</a></li>
          <li><a href={DOCS.security} rel="noopener noreferrer" className="underline">How we keep it safe</a></li>
        </ul>
      </section>

      <div className="mb-12">
        <LiveCounters gateway={gateway} />
      </div>

      <section aria-labelledby="story-heading" className="mb-12">
        <h2 id="story-heading" className="text-3xl font-bold text-slate-900">One fact runs through everything</h2>
        <p className="mt-3 max-w-3xl text-lg text-slate-800">
          Margaret is 74, stammers, and rings from a landline. Her <strong>08:12 to Paddington was 38 minutes late</strong>. That one fact runs
          through every part of Tempo, in this order.
        </p>
        <ol className="mt-6 space-y-4 border-l-4 border-teal-800 pl-6">
          {BEATS.map((beat, i) => (
            <li key={beat.name} className="relative">
              <span aria-hidden="true" className="absolute -left-[2.35rem] top-1 flex h-8 w-8 items-center justify-center rounded-full bg-teal-800 text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="text-xl font-semibold text-slate-900">{beat.name}</h3>
              <p className="mt-1 text-lg text-slate-800">{beat.sentence}</p>
              {beat.href.startsWith("http") ? (
                <a href={beat.href} rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center font-medium text-teal-900 underline">{beat.link}</a>
              ) : (
                <Link href={href(beat.href)} className="mt-1 inline-flex min-h-11 items-center font-medium text-teal-900 underline">{beat.link}</Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="forgotten-heading" className="mb-12">
        <h2 id="forgotten-heading" className="text-3xl font-bold text-slate-900">The people the internet forgot</h2>
        <p className="mt-3 max-w-3xl text-lg text-slate-800">
          The same people are hit from every side at once. They cannot read the letter, cannot hear the call, cannot navigate the app, and
          are the ones scammers target. Each need, and what Tempo does about it:
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {FORGOTTEN.map((item) => (
            <li key={item.need}>
              <Card className="h-full">
                <h3 className="text-xl font-semibold text-slate-900">&ldquo;{item.need}&rdquo;</h3>
                <p className="mt-2 text-slate-800">{item.answer}</p>
                <Link href={href(item.href)} className="mt-3 inline-flex min-h-11 items-center font-medium text-teal-900 underline">{item.link}</Link>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-lg text-slate-800">
          Tempo&apos;s answer is one agent that reads to you, listens patiently, warns you, and is built so that it <strong>cannot</strong> move your
          money or act without your signed yes. The <Link href={href("/profiles/read-it-to-me")} className="underline">Read It To Me profile</Link> is
          that agent: four skills on, every binding capability off.
        </p>
      </section>

      <section aria-labelledby="honesty-heading" className="mb-6">
        <h2 id="honesty-heading" className="text-2xl font-bold text-slate-900">What is honestly not done</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          {NOT_DONE.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="mt-3 text-slate-800">
          The badge at the top of Mission Control says what is real in each run. In the showcase everything is a recording of a replay-mode
          Gateway, and the badge says so.
        </p>
      </section>
    </div>
  );
}
