import type { BotListing, BotPack, BotPreview, InstalledBot } from "@steward/shared";

/** Sample packs and rows for the bots tests. Only test files import this. */

export const RENT_SCOUT: BotPack = {
  id: "rent-scout",
  name: "Rent Scout",
  pitch: "Finds rentals in your budget, flags scams and adds up the true move-in cost.",
  category: "home",
  version: 3,
  author: { kind: "ai", model: "anthropic/claude-sonnet-5.5", generated: "2026-10-28" },
  licence: "MIT",
  needs: {
    tools: ["browser_navigate", "browser_snapshot", "web_search", "mail_read"],
    connectors: ["mail"],
    model: "any",
  },
  instructions: "You help one person find a place to rent. Never pay a deposit.",
  starters: ["Find two-bed flats under £1,600 near Oxford.", "Is this listing a scam?"],
  examples: [
    {
      ask: "Is this listing a scam?",
      does: "Checks the address, the price and the contact, then says plainly.",
    },
  ],
  skills: [
    {
      name: "find-rentals",
      description: "Search the usual sites and compare what comes back.",
      body: "Open each site, read the listings, and put them in one table.",
    },
  ],
  rules: [
    {
      name: "Never pay a deposit",
      effect: "deny",
      when: 'tool.kind == "pay"',
      description: "Deposits are paid by you.",
    },
  ],
  routines: [],
  shortcuts: [],
  readme: "## What it does\n\nIt looks for flats and **reads the lease** for you.",
  hash: "a".repeat(64),
};

export const INVOICE_CHASER: BotPack = {
  ...RENT_SCOUT,
  id: "invoice-chaser",
  name: "Invoice Chaser",
  pitch: "Chases unpaid invoices politely, then firmly.",
  category: "money",
  version: 1,
  author: { kind: "person", handle: "sam", url: "https://example.com/sam" },
  needs: { tools: ["mail_list", "mail_send"], connectors: ["mail"], model: "any" },
  skills: [],
  rules: [],
  readme: "",
};

export function listingOf(pack: BotPack, over: Partial<BotListing> = {}): BotListing {
  return {
    id: pack.id,
    name: pack.name,
    pitch: pack.pitch,
    category: pack.category,
    version: pack.version,
    author: pack.author,
    needs: pack.needs,
    installs: 12,
    usedBy: 3,
    updatedAt: "2026-10-28T08:00:00Z",
    packUrl: `packs/${pack.id}.json`,
    ...over,
  };
}

export function previewOf(pack: BotPack, over: Partial<BotPreview> = {}): BotPreview {
  return {
    pack,
    mayDoWithoutAsking: ["browse the web on its own computer", "read your mail"],
    asksBefore: ["sending anything", "paying", "signing"],
    needsMissing: [],
    toolsMissing: [],
    ...over,
  };
}

export function installedOf(pack: BotPack, over: Partial<InstalledBot> = {}): InstalledBot {
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    hash: pack.hash ?? "b".repeat(64),
    source: "https://bots.example/index.json",
    installedAt: "2026-10-28T09:00:00Z",
    updatedAt: "2026-10-28T09:00:00Z",
    agentId: pack.id,
    skillIds: pack.skills.map((skill) => `skl_${skill.name}`),
    ruleIds: pack.rules.map((_, index) => `rul_${index}`),
    routineIds: [],
    ...over,
  };
}
