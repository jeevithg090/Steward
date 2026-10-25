// What the chat does in place of the hidden pages (plan.md §19): reading a letter or PDF, the
// ten owed questions and the scam check all happen in the conversation. A reply's button that
// pointed at one of those pages opens the tool here instead; one that pointed at Mission Control,
// Devices, Who's calling? or The story is left out, because History shows each chat's status.
// Once L has brought the pages back, every button goes to its page again.

/** A card the chat can show in the conversation. */
export type ChatTool = "owed" | "shield";

/** What a reply's button does: open its page, open a tool here, pick a file, or nothing (hidden). */
export type ActionRoute = { kind: "link" } | { kind: "tool"; tool: ChatTool } | { kind: "attach" } | { kind: "hide" };

/** The files the chat reads: photos of a letter or bill, and PDFs. */
export const ATTACH_ACCEPT = "image/*,application/pdf,.pdf";

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function routeAction(href: string, revealed: boolean): ActionRoute {
  if (revealed) return { kind: "link" };
  const path = href.replace(/^#/, "").split("?")[0] ?? "";
  if (path === "/owed") return { kind: "tool", tool: "owed" };
  if (path === "/shield") return { kind: "tool", tool: "shield" };
  if (path === "/read") return { kind: "attach" };
  if (/^\/(missions|devices|callers|story)(\/|$)/.test(path)) return { kind: "hide" };
  return { kind: "link" };
}

/** What Tempo says when it opens a tool in the conversation. */
export const TOOL_INTRO: Record<ChatTool, { title: string; text: string }> = {
  owed: { title: "Am I owed anything?", text: "Ten quick questions, then I'll show what looks worth claiming, with the official page for each. I only look and explain here; I never file anything for you." },
  shield: { title: "Is this a scam?", text: "Paste the text or email you're unsure of, and I'll tell you if it looks like a trick, and why." },
};
