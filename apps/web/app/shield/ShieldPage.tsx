"use client";

import { useMemo } from "react";
import { ShieldPanel } from "@/components/ShieldPanel";
import { ShieldStory } from "@/components/ShieldStory";
import { PageIntro } from "@/components/site/ui";
import { ShieldClient, ShowcaseShield, browserNarrator, browserVoice, type Narrator, type ShieldSource } from "@/lib/shield";
import { useShowcase } from "@/lib/use-showcase";

/** The story first, then the proof, then the numbers, then a message of your own. */
export function ShieldPage({ source: injected, narrator: injectedNarrator }: { source?: ShieldSource; narrator?: Narrator }) {
  const showcase = useShowcase();
  const source = useMemo<ShieldSource>(() => injected ?? (showcase.active ? new ShowcaseShield() : new ShieldClient()), [injected, showcase.active]);
  const voice = useMemo(() => browserVoice(), []);
  const narrator = useMemo(() => injectedNarrator ?? browserNarrator(), [injectedNarrator]);
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-6 sm:px-6">
      <PageIntro title="Scam Shield">
        An agent that runs in the background on the phone, reads incoming texts on the device, and speaks when one is a trick:
        &quot;Do not touch that message. It is a trick trying to take your money.&quot; Built for people who cannot read the letter, hear the
        call or trust the message, and are the ones scammers target.
      </PageIntro>
      <ShieldStory narrator={narrator} />
      <section aria-labelledby="try-heading" className="space-y-4">
        <h2 id="try-heading" className="text-3xl font-bold">
          Try it yourself
        </h2>
        {source.showcase && (
          <p role="note" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-3 text-base">
            Showcase: there is no Gateway, so the four example messages answer with replies recorded from a real replay-mode Gateway. Run
            Tempo locally to check your own messages.
          </p>
        )}
        <ShieldPanel source={source} voice={voice} userId="u_margaret" />
      </section>
    </div>
  );
}
