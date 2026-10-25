"use client";

import { useMemo } from "react";
import { ShieldPanel } from "@/components/ShieldPanel";
import { PageIntro } from "@/components/site/ui";
import { ShieldClient, ShowcaseShield, browserVoice, type ShieldSource } from "@/lib/shield";
import { useShowcase } from "@/lib/use-showcase";

/** Live Gateway or the recorded showcase, decided the same way as every other page. */
export function ShieldPage({ source: injected }: { source?: ShieldSource }) {
  const showcase = useShowcase();
  const source = useMemo<ShieldSource>(() => injected ?? (showcase.active ? new ShowcaseShield() : new ShieldClient()), [injected, showcase.active]);
  const voice = useMemo(() => browserVoice(), []);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageIntro title="Scam Shield">
        On a phone, Tempo reads incoming texts on the device and speaks when one is a trick: &quot;Do not touch that message. It is a trick trying to
        take your money.&quot; Here you can check a message by hand. The same code answers the phone, a text to Tempo (<code>CHECK</code> then the message)
        and the voice line.
      </PageIntro>
      {source.showcase && (
        <p role="note" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-3 text-base">
          Showcase: there is no Gateway, so the four example messages answer with replies recorded from a real replay-mode Gateway. Run Tempo
          locally to check your own messages.
        </p>
      )}
      <ShieldPanel source={source} voice={voice} userId="u_margaret" />
    </div>
  );
}
