import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOT_CATEGORIES, type BotListing, type BotPack } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { hashPack } from "../src/canonical.ts";
import { buildIndex, DirectoryClient } from "../src/directory.ts";
import { parseBotFolder, writeBotFolder } from "../src/pack.ts";

const NEEDS = { tools: ["web_search", "web_fetch"], connectors: [], model: "any" };

function pack(id: string, extra: Partial<BotPack>): BotPack {
  return {
    id,
    name: id,
    pitch: "A bot.",
    category: "misc",
    version: 1,
    author: { kind: "person", handle: "sam" },
    licence: "MIT",
    needs: NEEDS,
    instructions: "Help the person.",
    starters: [],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
    ...extra,
  };
}

/** Sets every file's modified time, so `updatedAt` is known. */
function setMtime(dir: string, date: Date): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) setMtime(path, date);
    else utimesSync(path, date, date);
  }
}

let root: string;
let warnings: string[];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "steward-bots-"));
  const bots = join(root, "bots");
  await writeBotFolder(
    join(bots, "rent-scout"),
    pack("rent-scout", {
      name: "Rent Scout",
      pitch: "Finds rentals in your budget and flags scams.",
      category: "home",
      starters: ["Find two-bed flats near Oxford."],
      skills: [
        {
          name: "find-rentals",
          description: "Finds rentals.",
          body: "Search the usual sites.",
          allowedTools: ["web_search"],
        },
      ],
      rules: [
        { name: "Never pay", effect: "deny", when: 'tool.kind == "pay"', description: "Deposits are yours." },
      ],
      readme: "# Rent Scout\n\nFinds rentals.",
    }),
  );
  await writeBotFolder(
    join(bots, "meal-planner"),
    pack("meal-planner", {
      name: "Meal Planner",
      pitch: "Plans a week of dinners and writes the shopping list.",
      category: "food",
      author: { kind: "ai", model: "test/model", generated: "2026-10-28" },
    }),
  );
  await writeBotFolder(
    join(bots, "inbox-zero"),
    pack("inbox-zero", {
      name: "Inbox Zero",
      pitch: "Sorts your mail and chases rent receipts.",
      category: "productivity",
      needs: { tools: ["mail_list", "mail_read"], connectors: ["mail"], model: "any" },
    }),
  );
  // Fails validation: an allow rule. writeBotFolder refuses it, so it is written by hand.
  const { readme: _readme, skills: _skills, ...badDoc } = pack("bad-bot", {});
  mkdirSync(join(bots, "bad-bot"), { recursive: true });
  writeFileSync(
    join(bots, "bad-bot", "bot.yaml"),
    stringifyYaml({
      ...badDoc,
      rules: [{ name: "Allow all", effect: "allow", when: "true", description: "" }],
    }),
  );
  // The folder name is not the id.
  await writeBotFolder(join(bots, "wrong-id"), pack("other", {}));
  // A skill whose frontmatter name does not match its folder.
  await writeBotFolder(
    join(bots, "mismatch"),
    pack("mismatch", { skills: [{ name: "alpha", description: "A.", body: "B." }] }),
  );
  writeFileSync(
    join(bots, "mismatch", "skills", "alpha", "SKILL.md"),
    "---\nname: beta\ndescription: A.\n---\nB.\n",
  );
  // Not a bot folder at all.
  mkdirSync(join(bots, "empty"));

  setMtime(join(bots, "rent-scout"), new Date("2026-01-05T00:00:00Z"));
  setMtime(join(bots, "meal-planner"), new Date("2026-03-05T00:00:00Z"));
  setMtime(join(bots, "inbox-zero"), new Date("2026-02-05T00:00:00Z"));
  writeFileSync(
    join(root, "counts.json"),
    JSON.stringify({
      "rent-scout": { installs: 40, usedBy: 9 },
      "inbox-zero": { installs: 100, usedBy: 2 },
      "meal-planner": { installs: 12, usedBy: 30 },
    }),
  );

  warnings = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
  await buildIndex(root, { name: "Test bots", site: "https://bots.example.com/" });
  spy.mockRestore();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildIndex", () => {
  it("writes index.json and one pack per valid bot, with hashes", () => {
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
    expect(index.name).toBe("Test bots");
    expect(index.site).toBe("https://bots.example.com");
    expect(index.categories).toEqual(BOT_CATEGORIES);
    expect(index.bots.map((b: BotListing) => b.id)).toEqual(["inbox-zero", "meal-planner", "rent-scout"]);
    const rent = index.bots.find((b: BotListing) => b.id === "rent-scout") as BotListing;
    expect(rent).toEqual({
      id: "rent-scout",
      name: "Rent Scout",
      pitch: "Finds rentals in your budget and flags scams.",
      category: "home",
      version: 1,
      author: { kind: "person", handle: "sam" },
      needs: NEEDS,
      installs: 40,
      usedBy: 9,
      updatedAt: "2026-01-05T00:00:00.000Z",
      packUrl: "packs/rent-scout.json",
      pageUrl: "https://bots.example.com/bots/rent-scout",
    });
    const written = JSON.parse(readFileSync(join(root, "packs", "rent-scout.json"), "utf8")) as BotPack;
    expect(written.hash).toBe(hashPack(written));
    expect(written.skills[0]?.name).toBe("find-rentals");
    expect(written.readme).toBe("# Rent Scout\n\nFinds rentals.");
    expect(existsSync(join(root, "packs", "bad-bot.json"))).toBe(false);
  });

  it("skips bad folders with a warning that names the problem", () => {
    expect(warnings).toContain(
      "bots/bad-bot: skipped: bot.yaml: rules[0].effect: A bot can only tighten the rules: a rule may ask or deny, never allow",
    );
    expect(warnings).toContain(
      'bots/wrong-id: skipped: bot.yaml says id "other" but the folder is "wrong-id"',
    );
    expect(warnings).toContain(
      'bots/mismatch: skipped: skills/alpha/SKILL.md: name: "beta" must match the folder name "alpha"',
    );
    expect(warnings).toContain("bots/empty: skipped: bot.yaml: is missing");
    expect(warnings.filter((w) => w.includes("skipped"))).toHaveLength(4);
  });

  it("round-trips a bot folder", async () => {
    const read = await parseBotFolder(join(root, "bots", "rent-scout"));
    expect(read).toEqual(
      pack("rent-scout", {
        name: "Rent Scout",
        pitch: "Finds rentals in your budget and flags scams.",
        category: "home",
        starters: ["Find two-bed flats near Oxford."],
        skills: [
          {
            name: "find-rentals",
            description: "Finds rentals.",
            body: "Search the usual sites.",
            allowedTools: ["web_search"],
          },
        ],
        rules: [
          {
            name: "Never pay",
            effect: "deny",
            when: 'tool.kind == "pay"',
            description: "Deposits are yours.",
          },
        ],
        readme: "# Rent Scout\n\nFinds rentals.",
      }),
    );
    const yaml = readFileSync(join(root, "bots", "rent-scout", "bot.yaml"), "utf8");
    expect(yaml).toContain("skills:\n  - find-rentals");
    expect(yaml).not.toContain("readme");
  });

  it("names the file and field when a folder is wrong", async () => {
    const dir = join(root, "scratch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bot.yaml"), "id: scratch\nstarter: [x]\n");
    await expect(parseBotFolder(dir)).rejects.toThrow('bot.yaml: unknown field "starter"');
    writeFileSync(join(dir, "bot.yaml"), "id: scratch\nname: S\nskills: [nope]\n");
    await expect(parseBotFolder(dir)).rejects.toThrow("skills/nope/SKILL.md: is missing");
    writeFileSync(join(dir, "bot.yaml"), "id: Scratch\nname: S\n");
    await expect(parseBotFolder(dir)).rejects.toThrow(/bot\.yaml: id: /);
    await expect(parseBotFolder(join(root, "nowhere"))).rejects.toThrow(/Bot folder not found/);
  });
});

describe("DirectoryClient on a folder", () => {
  let client: DirectoryClient;
  beforeAll(() => {
    client = new DirectoryClient({ source: join(root, "index.json") });
  });

  const ids = async (q: Parameters<DirectoryClient["list"]>[0]) =>
    (await client.list(q)).bots.map((b) => b.id);

  it("ranks by installs when there is nothing to match", async () => {
    const found = await client.list({ sort: "match", limit: 50, offset: 0 });
    expect(found.total).toBe(3);
    expect(found.bots.map((b) => b.id)).toEqual(["inbox-zero", "rent-scout", "meal-planner"]);
  });

  it("puts a name match above a pitch match, whatever the installs", async () => {
    // inbox-zero has 100 installs and "rent" in its pitch; Rent Scout has it in its name.
    expect(await ids({ q: "rent", sort: "match", limit: 50, offset: 0 })).toEqual([
      "rent-scout",
      "inbox-zero",
    ]);
    expect(await ids({ q: "a bot that flags scam listings", sort: "match", limit: 50, offset: 0 })).toEqual([
      "rent-scout",
    ]);
    expect(await ids({ q: "dinner", sort: "match", limit: 50, offset: 0 })).toEqual(["meal-planner"]);
    expect(await ids({ q: "food", sort: "match", limit: 50, offset: 0 })).toEqual(["meal-planner"]);
    expect(await ids({ q: "unicorns", sort: "match", limit: 50, offset: 0 })).toEqual([]);
  });

  it("filters by category and pages with limit and offset", async () => {
    expect(await ids({ category: "food", sort: "match", limit: 50, offset: 0 })).toEqual(["meal-planner"]);
    const page = await client.list({ sort: "match", limit: 1, offset: 1 });
    expect(page.bots.map((b) => b.id)).toEqual(["rent-scout"]);
    expect(page.total).toBe(3);
    expect(await ids({ sort: "match", limit: 2, offset: 5 })).toEqual([]);
  });

  it("sorts by new, used and installs", async () => {
    expect(await ids({ sort: "new", limit: 50, offset: 0 })).toEqual([
      "meal-planner",
      "inbox-zero",
      "rent-scout",
    ]);
    expect(await ids({ sort: "used", limit: 50, offset: 0 })).toEqual([
      "meal-planner",
      "rent-scout",
      "inbox-zero",
    ]);
    expect(await ids({ sort: "installs", limit: 50, offset: 0 })).toEqual([
      "inbox-zero",
      "rent-scout",
      "meal-planner",
    ]);
  });

  it("gets one listing and its pack, checked against its hash", async () => {
    const listing = await client.get("rent-scout");
    expect(listing?.name).toBe("Rent Scout");
    expect(await client.get("nope")).toBeUndefined();
    const fetched = await client.pack(listing as BotListing);
    expect(fetched.id).toBe("rent-scout");
    expect(fetched.hash).toBe(hashPack(fetched));
    expect(await client.pack("packs/rent-scout.json")).toEqual(fetched);
  });

  it("refuses a pack that changed since it was listed, and a path outside the folder", async () => {
    const path = join(root, "packs", "meal-planner.json");
    const original = readFileSync(path, "utf8");
    const changed = JSON.parse(original) as BotPack;
    changed.pitch = "Now something else.";
    writeFileSync(path, JSON.stringify(changed));
    try {
      await expect(client.pack("packs/meal-planner.json")).rejects.toThrow(
        "pack changed since it was listed",
      );
    } finally {
      writeFileSync(path, original);
    }
    await expect(client.pack("../outside.json")).rejects.toThrow(/inside the directory folder/);
    await expect(client.pack("packs/missing.json")).rejects.toThrow();
    writeFileSync(join(root, "packs", "broken.json"), '{"id": "broken"}');
    await expect(client.pack("packs/broken.json")).rejects.toThrow(/not valid: name/);
  });
});

describe("DirectoryClient on the web", () => {
  const INDEX_URL = "https://bots.example.com/index.json";
  let files: Record<string, string>;
  let fetched: string[];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    const body = files[url];
    return body === undefined
      ? new Response("not here", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;

  beforeAll(() => {
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as { bots: BotListing[] };
    const meal = index.bots.find((b) => b.id === "meal-planner") as BotListing;
    meal.packUrl = `file://${join(root, "packs", "meal-planner.json")}`;
    const inbox = index.bots.find((b) => b.id === "inbox-zero") as BotListing;
    inbox.packUrl = "https://cdn.example.com/inbox-zero.json";
    files = {
      [INDEX_URL]: JSON.stringify(index),
      "https://bots.example.com/packs/rent-scout.json": readFileSync(
        join(root, "packs", "rent-scout.json"),
        "utf8",
      ),
      "https://cdn.example.com/inbox-zero.json": readFileSync(join(root, "packs", "inbox-zero.json"), "utf8"),
    };
    fetched = [];
  });

  it("resolves relative pack URLs against the index and never follows file:", async () => {
    const client = new DirectoryClient({ source: INDEX_URL, fetch: fakeFetch });
    const rent = await client.get("rent-scout");
    expect(client.resolvePackUrl(rent?.packUrl ?? "")).toBe("https://bots.example.com/packs/rent-scout.json");
    expect((await client.pack(rent as BotListing)).id).toBe("rent-scout");
    expect((await client.pack("https://cdn.example.com/inbox-zero.json")).id).toBe("inbox-zero");
    const meal = await client.get("meal-planner");
    await expect(client.pack(meal as BotListing)).rejects.toThrow(/must be web addresses too/);
    await expect(client.pack("packs/nope.json")).rejects.toThrow(/answered 404/);
    expect(fetched.some((u) => u.startsWith("file:"))).toBe(false);
  });

  it("reads the index once per cache period, and again after invalidate", async () => {
    fetched = [];
    const client = new DirectoryClient({ source: INDEX_URL, fetch: fakeFetch, cacheMs: 60_000 });
    await Promise.all([client.index(), client.index()]);
    await client.list({ sort: "match", limit: 50, offset: 0 });
    expect(fetched.filter((u) => u === INDEX_URL)).toHaveLength(1);
    client.invalidate();
    await client.index();
    expect(fetched.filter((u) => u === INDEX_URL)).toHaveLength(2);
    const fresh = new DirectoryClient({ source: INDEX_URL, fetch: fakeFetch, cacheMs: 0 });
    await fresh.index();
    await fresh.index();
    expect(fetched.filter((u) => u === INDEX_URL)).toHaveLength(4);
  });

  it("says when the index is missing or not an index", async () => {
    await expect(
      new DirectoryClient({ source: "https://bots.example.com/none.json", fetch: fakeFetch }).index(),
    ).rejects.toThrow(/answered 404/);
    files["https://bots.example.com/bad.json"] = '{"bots": "no"}';
    await expect(
      new DirectoryClient({ source: "https://bots.example.com/bad.json", fetch: fakeFetch }).index(),
    ).rejects.toThrow(/index is not valid: name/);
    files["https://bots.example.com/html.json"] = "<html>";
    await expect(
      new DirectoryClient({ source: "https://bots.example.com/html.json", fetch: fakeFetch }).index(),
    ).rejects.toThrow(/is not JSON/);
  });
});
