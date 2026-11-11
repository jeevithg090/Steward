/**
 * What the agent's computer said for the person, in the conversation, while its panel is out of
 * sight: why a secret was not typed in, or that an input did not reach the screen. The panel shows
 * these under the screen, but on most screens it is closed, and the secret box has already gone.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { announce } from "@/lib/announce.ts";
import type { Computer } from "../computer/session.tsx";

export function ComputerNotice({ computer, hidden }: { computer: Computer | null; hidden: boolean }) {
  const notice = hidden ? (computer?.notice ?? null) : null;
  // Drawn where nobody is listening yet, so it is said through the page's own live region.
  useEffect(() => {
    if (notice) announce(notice);
  }, [notice]);
  if (!notice || !computer) return null;
  return (
    <Notice
      title={`${computer.name}'s computer`}
      action={
        <Button size="sm" variant="ghost" onClick={() => computer.clearNotice()}>
          Dismiss
        </Button>
      }
    >
      {notice}
    </Notice>
  );
}
