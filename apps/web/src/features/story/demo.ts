// The sentences the guided demo sends to the chat (plan.md §12.2: `#/chat?say=<text>` sends the
// text once, as if typed). One place, so the story, Profiles, Skills and Memory say the same thing
// and the recordings in the showcase recognise it.
import { SAMPLES } from "@/lib/shield";

export const SAY = {
  /** Margaret's train: the recorded journey (a date with no recording only gets a plain apology). */
  lateTrain: "My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40",
  broadband: "The Broadbandly engineer never came on 19 October",
  remember: "What do you remember about me?",
  returned: "How much have you got back for me?",
  owed: "Am I owed anything?",
  scam: `Is this a scam? ${SAMPLES[0].text}`,
} as const;

/** The hash link that sends `text` in the chat. */
export function chatSay(text: string): string {
  return `#/chat?say=${encodeURIComponent(text)}`;
}

/** A sentence shortened for a hint under a button ("Sends “My 08:12 Oxford…”"). */
export function shortSay(text: string, max = 90): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Big enough to hit with a thumb (WCAG 2.5.5): every button and link-as-button on these pages. */
export const TAP = "min-h-[44px]";
