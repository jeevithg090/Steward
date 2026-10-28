import type { CatalogueEntry, DeviceScope } from "@steward/shared";

/**
 * The phone catalogue (docs/plans/phone-and-shortcuts.md §4.3): what this person's Steward offers to
 * a shortcut or the phone app, built from their profile. One list drives the home menu
 * (`/device/home`), `/device/run/:actionId`, the launchers and the Shortcuts page, so a new skill
 * or routine shows up on the phone with no re-import.
 */

/** A tenant's own shortcut, from `tenants/<id>/shortcuts.yaml`. */
export interface TenantShortcut {
  id: string;
  title: string;
  description: string;
  siri?: string;
  /** Run as this skill, as if the person typed `/skill` first. */
  skill?: string;
  /** What Steward is asked, with `{input}` where the shared or dictated words go. */
  prompt: string;
  /** Offered from the share sheet. */
  share?: boolean;
  scopes?: DeviceScope[];
}

export interface PhoneProfile {
  /** The person's and the tenant's skills, by name. */
  skills: { name: string; description: string }[];
  routines: { id: string; title: string; enabled: boolean }[];
  /** Installed bots and the launchers their packs bring. */
  bots: { id: string; name: string; shortcuts: CatalogueEntry[] }[];
  /** Mail is connected (the demo inbox counts): "Check this message" means more with it. */
  mailConnected: boolean;
  /** `HH:MM`, when the morning brief is made. */
  briefTime?: string;
  tenant?: { id: string; name: string; shortcuts: TenantShortcut[] };
}

const ID = /^[a-z0-9][a-z0-9_.-]{0,60}$/;

/** `weekly-review` → "Weekly review", for a menu row and a Siri phrase. */
export function humanise(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : name;
}

/** Short, so a menu row and a Siri phrase stay readable. */
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const CORE: CatalogueEntry[] = [
  {
    id: "ask",
    title: "Ask Steward",
    description: "Say or type what you need; Steward answers here.",
    siriPhrase: "Steward",
    action: { kind: "say" },
    scopes: ["chat"],
    source: "core",
  },
  {
    id: "brief",
    title: "What needs me?",
    description: "Today's brief: what needs you, read aloud.",
    siriPhrase: "Steward: What needs me?",
    action: { kind: "brief" },
    scopes: ["brief:read"],
    source: "core",
  },
  {
    id: "approvals",
    title: "Needs you",
    description: "What Steward is waiting for you to answer.",
    siriPhrase: "Steward: Needs you",
    action: { kind: "approvals" },
    scopes: ["approvals:read"],
    source: "core",
  },
];

/** "Check this": shared text from the share sheet. The generic shortcut sends shared text here. */
const CHECK = (mail: boolean): CatalogueEntry => ({
  id: "check",
  title: "Check this",
  description: mail
    ? "Share a message or link to Steward: is it genuine, and does it need you?"
    : "Share a message or link to Steward: is it genuine?",
  siriPhrase: "Check with Steward",
  action: { kind: "check" },
  scopes: ["chat"],
  source: "core",
});

/**
 * Builds the catalogue. Ids are stable (`skill:<name>`, `routine:<id>`, `bot:<bot>:<entry>`,
 * `tenant:<id>`), so a launcher made today still works after the list changes. Paused routines
 * and entries with ids that could not be named safely are left out.
 */
export function buildCatalogue(profile: PhoneProfile): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [...CORE, CHECK(profile.mailConnected)];
  const seen = new Set(entries.map((e) => e.id));
  const push = (entry: CatalogueEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };

  for (const skill of profile.skills) {
    if (!ID.test(skill.name)) continue;
    push({
      id: `skill:${skill.name}`,
      title: humanise(skill.name),
      description: clip(skill.description, 160),
      siriPhrase: `Steward: ${humanise(skill.name)}`,
      action: { kind: "skill", ref: skill.name },
      scopes: ["chat"],
      source: "skill",
    });
  }

  for (const routine of profile.routines) {
    if (!routine.enabled || !ID.test(routine.id)) continue;
    push({
      id: `routine:${routine.id}`,
      title: clip(routine.title, 60),
      description: "Run this routine now.",
      siriPhrase: `Steward: ${clip(routine.title, 40)}`,
      action: { kind: "routine", ref: routine.id },
      scopes: ["routines:run"],
      source: "routine",
    });
  }

  for (const shortcut of profile.tenant?.shortcuts ?? []) {
    if (!ID.test(shortcut.id)) continue;
    const prompt = shortcut.skill ? `/${shortcut.skill} ${shortcut.prompt}` : shortcut.prompt;
    push({
      id: `tenant:${shortcut.id}`,
      title: clip(shortcut.title, 60),
      description: clip(shortcut.description, 200),
      ...(shortcut.siri ? { siriPhrase: shortcut.siri } : {}),
      action: { kind: "tenant", ref: shortcut.id },
      scopes: shortcut.scopes?.length ? shortcut.scopes : ["chat"],
      source: "tenant",
      prompt,
    });
  }

  for (const bot of profile.bots) {
    if (!ID.test(bot.id)) continue;
    for (const entry of bot.shortcuts) {
      if (!entry || typeof entry.id !== "string" || !ID.test(entry.id)) continue;
      // A bot may only point at its own skills or give a prompt; it never widens what a phone may do.
      const ref = entry.action?.ref;
      const prompt =
        typeof entry.prompt === "string"
          ? entry.prompt
          : entry.action?.kind === "skill" && ref
            ? `/${ref} {input}`
            : undefined;
      if (!prompt) continue;
      push({
        id: `bot:${bot.id}:${entry.id}`,
        title: clip(entry.title || bot.name, 60),
        description: clip(entry.description || "", 200),
        ...(entry.siriPhrase ? { siriPhrase: clip(entry.siriPhrase, 60) } : {}),
        action: { kind: "bot", ref: bot.id },
        scopes: ["chat"],
        source: "bot",
        prompt,
      });
    }
  }
  return entries;
}

/**
 * The morning brief as a phone automation, when the person has a brief time. iOS 27 can carry an
 * automation inside a shared shortcut, but how it is encoded is not known yet (device check 7), so
 * the Shortcuts page shows how to add it by hand: weekdays at this time, run Steward with
 * `action:brief`.
 */
export function briefAutomation(
  profile: Pick<PhoneProfile, "briefTime">,
): { time: string; input: string } | undefined {
  const time = profile.briefTime;
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  return { time, input: "action:brief" };
}
