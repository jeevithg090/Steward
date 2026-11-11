import type { AppInfo, BotListing, BotPack, BotPreview } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVOICE_CHASER, installedOf, listingOf, previewOf, RENT_SCOUT } from "@/components/bots/fixtures.ts";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { BotAddPage } from "./BotAddPage.tsx";
import { BotListingPage } from "./BotListingPage.tsx";
import { BotsPage } from "./BotsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INFO = {
  brand: { name: "Steward", tagline: "", accent: "#0f6e66", voice: "" },
  agents: [
    {
      id: "steward",
      name: "Steward",
      title: "",
      instructions: "",
      skills: [],
      tools: ["*"],
      source: "tenant",
    },
  ],
  starters: [],
  model: { provider: "scripted", model: "-", scripted: true },
  mail: { connected: false, label: "Demo inbox", isDemo: true },
  version: "0.1.0",
  singleUser: true,
} satisfies AppInfo;

const LISTINGS = [listingOf(RENT_SCOUT), listingOf(INVOICE_CHASER, { installs: 0, usedBy: 0 })];

/** The directory and the preview, as the server answers them. */
function serve(
  opts: {
    installed?: ReturnType<typeof installedOf>[];
    previewStatus?: number;
    mailConnected?: boolean;
    /** The preview to answer with, in place of the fixture's. */
    preview?: BotPreview;
    /** The directory's listings, in place of the two fixtures. */
    listings?: BotListing[];
    /** What the server says when it has no directory to read. */
    problem?: string;
    /** A real model, not the scripted one. */
    realModel?: boolean;
    /** What Make a bot answers with. */
    made?: BotPack;
  } = {},
) {
  const listings = opts.listings ?? LISTINGS;
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/info")
      return {
        body: {
          ...INFO,
          mail: { ...INFO.mail, connected: opts.mailConnected ?? false },
          ...(opts.realModel
            ? { model: { provider: "openrouter", model: "some-model", scripted: false } }
            : {}),
        },
      };
    if (req.path === "/api/bots/make" && req.method === "POST" && opts.made) return { body: opts.made };
    if (req.path === "/api/bots" && req.method === "GET") {
      const q = req.query.get("q")?.toLowerCase();
      const category = req.query.get("category");
      const needs = req.query.get("needs");
      const matches = listings.filter(
        (bot) =>
          (!q || `${bot.id} ${bot.name}`.toLowerCase().includes(q)) &&
          (!category || bot.category === category) &&
          (!needs || bot.needs.connectors.includes(needs)),
      );
      const offset = Number(req.query.get("offset") ?? 0);
      const limit = Number(req.query.get("limit") ?? 50);
      return {
        body: {
          bots: matches.slice(offset, offset + limit),
          total: matches.length,
          categories: { home: "Home & family", money: "Money & finance" },
          ...(opts.problem ? { directory: { name: "", problem: opts.problem } } : {}),
        },
      };
    }
    if (req.path === "/api/bots/installed") return { body: opts.installed ?? [] };
    if (req.path === "/api/bots/preview" && req.method === "POST") {
      if (opts.previewStatus)
        return { status: opts.previewStatus, body: { error: "Couldn't fetch that pack." } };
      const body = req.body as { packUrl?: string; pack?: { id: string } };
      const id = body.pack?.id ?? body.packUrl?.match(/([a-z-]+)\.json$/)?.[1];
      if (opts.preview) return { body: opts.preview };
      const pack = id === INVOICE_CHASER.id ? INVOICE_CHASER : RENT_SCOUT;
      return { body: previewOf(pack, { needsMissing: ["mail"] }) };
    }
    if (req.path === "/api/bots/install" && req.method === "POST") return { body: installedOf(RENT_SCOUT) };
    if (req.path === "/api/skills" || req.path === "/api/rules" || req.path === "/api/routines")
      return { body: [] };
    return undefined;
  });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

describe("BotsPage", () => {
  it("lists the directory as cards, with AI-made and people told apart", async () => {
    serve();
    renderWithProviders(<BotsPage />, { route: "/bots" });
    expect(await screen.findByRole("heading", { level: 1, name: "Bots" })).toBeTruthy();
    const rent = await screen.findByRole("article", { name: "Rent Scout" });
    expect(within(rent).getByText("AI-made")).toBeTruthy();
    expect(within(rent).getByText("12 added · 3 use it")).toBeTruthy();
    expect(within(rent).getByText("Home & family")).toBeTruthy();
    expect(within(rent).getByText("your mail")).toBeTruthy();
    expect(within(rent).getByRole("button", { name: "Add Rent Scout" })).toBeTruthy();
    expect(within(rent).getByRole("link", { name: "View Rent Scout" }).getAttribute("href")).toBe(
      "/bots/rent-scout",
    );

    const chaser = screen.getByRole("article", { name: "Invoice Chaser" });
    expect(within(chaser).getByText("by sam")).toBeTruthy();
    expect(within(chaser).queryByText("AI-made")).toBeNull();
    expect(within(chaser).getByText("Not yet used by anyone")).toBeTruthy();

    expect(screen.getByRole("searchbox", { name: "What do you need a bot for?" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Home & family" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Make a bot" })).toBeTruthy();
  });

  it("shows a page of bots at a time, and Show more asks from where the last page ended", async () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      listingOf(RENT_SCOUT, { id: `bot-${i + 1}`, name: `Bot ${i + 1}`, category: "home" }),
    );
    const { calls } = serve({ listings: many });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const browse = await screen.findByRole("region", { name: "Browse" });
    const names = () => [...browse.querySelectorAll("article h3")].map((h) => h.textContent);
    await within(browse).findByText("Bot 60");
    expect(names()).toHaveLength(61); // 60 bots and Make a bot
    expect(within(browse).queryByText("Bot 61")).toBeNull();
    // The count is a live status, so a screen reader hears it change.
    expect(within(browse).getByRole("status").textContent).toBe("Showing 60 of 75 bots");

    fireEvent.click(within(browse).getByRole("button", { name: "Show more bots" }));
    await within(browse).findByText("Bot 75");
    expect(names()).toHaveLength(76);
    expect(names()[0]).toBe("Bot 1");
    expect(within(browse).getByRole("status").textContent).toBe("75 bots");
    expect(within(browse).queryByRole("button", { name: "Show more bots" })).toBeNull();
    const pages = calls.filter((c) => c.path === "/api/bots" && !c.query.has("category"));
    expect(pages.map((c) => c.query.get("offset"))).toEqual(["0", "60"]);
  }, 20_000);

  it("searches as you type, after a pause, and filters by category", async () => {
    const { calls } = serve();
    renderWithProviders(
      <>
        <BotsPage />
        <Where />
      </>,
      { route: "/bots" },
    );
    const browse = await screen.findByRole("region", { name: "Browse" });
    await within(browse).findByRole("article", { name: "Invoice Chaser" });
    fireEvent.change(screen.getByRole("searchbox", { name: "What do you need a bot for?" }), {
      target: { value: "rent" },
    });
    // Nothing is asked while the words are still coming.
    expect(screen.getByTestId("where").textContent).toBe("/bots");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/bots?q=rent"));
    const results = await screen.findByRole("region", { name: "Results" });
    await within(results).findByRole("article", { name: "Rent Scout" });
    expect(within(results).queryByRole("article", { name: "Invoice Chaser" })).toBeNull();
    expect(within(results).getByRole("status").textContent).toBe("1 bot for “rent”");
    expect(calls.some((c) => c.path === "/api/bots" && c.query.get("q") === "rent")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Money & finance" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/bots?q=rent&category=money"));
    expect(await within(results).findByRole("heading", { name: "No bots match" })).toBeTruthy();
    expect(within(results).getByRole("status").textContent).toBe("0 bots in Money & finance for “rent”");
    expect(within(results).getByText(/Try a few plain words about the job/)).toBeTruthy();
  });

  it("filters by what a bot uses, and keeps the choice in the address", async () => {
    const { calls } = serve();
    renderWithProviders(
      <>
        <BotsPage />
        <Where />
      </>,
      { route: "/bots" },
    );
    await screen.findByRole("article", { name: "Invoice Chaser" });
    const uses = screen.getByRole("group", { name: "What it uses" });
    fireEvent.click(within(uses).getByRole("radio", { name: "Your mail" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/bots?needs=mail"));
    const results = await screen.findByRole("region", { name: "Results" });
    await waitFor(() =>
      expect(within(results).getByRole("status").textContent).toBe("2 bots using your mail"),
    );
    expect(calls.some((c) => c.path === "/api/bots" && c.query.get("needs") === "mail")).toBe(true);
    fireEvent.click(within(uses).getByRole("radio", { name: "Chat only" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/bots?needs=none"));
    await waitFor(() => expect(within(results).getByRole("status").textContent).toBe("0 bots for chat only"));
  });

  it("says when the directory has not been built, and how to build it, instead of 'empty'", async () => {
    serve({ listings: [], problem: "The bot directory has not been built yet." });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const browse = await screen.findByRole("region", { name: "Browse" });
    expect(await within(browse).findByText("The bot directory has not been built yet.")).toBeTruthy();
    expect(within(browse).getByText("pnpm --filter @steward/bots-gen seed build")).toBeTruthy();
    expect(within(browse).queryByText("The directory is empty")).toBeNull();
  });

  it("says a made bot is a template when the model's answer could not be used", {
    timeout: 20_000,
  }, async () => {
    const template: BotPack = {
      ...RENT_SCOUT,
      id: "flat-finder",
      name: "Flat Finder",
      author: { kind: "ai", model: "template", generated: "2026-11-10" },
    };
    serve({ realModel: true, made: template });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    await screen.findByRole("article", { name: "Rent Scout" });
    fireEvent.click(screen.getAllByRole("button", { name: "Make a bot" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make a bot" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /What should it do/ }), {
      target: { value: "find me a flat to rent near Oxford" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the bot" }));
    const made = await screen.findByRole("dialog", { name: "Flat Finder" });
    expect(
      await within(made).findByText(/Made from a template because the model's answer could not be used/),
    ).toBeTruthy();
  });

  it("suggests inbox bots when mail is connected, everyday ones otherwise", async () => {
    const offline = serve();
    renderWithProviders(<BotsPage />, { route: "/bots" });
    await screen.findByRole("article", { name: "Rent Scout" });
    await waitFor(() =>
      expect(offline.calls.some((c) => c.path === "/api/bots" && c.query.get("category") === "misc")).toBe(
        true,
      ),
    );
    cleanup();
    vi.unstubAllGlobals();

    const connected = serve({ mailConnected: true });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    await screen.findByRole("article", { name: "Rent Scout" });
    await waitFor(() =>
      expect(
        connected.calls.some((c) => c.path === "/api/bots" && c.query.get("category") === "productivity"),
      ).toBe(true),
    );
  });

  it("shows what is installed, with its version and Remove", async () => {
    const { calls } = serve({
      installed: [
        installedOf(RENT_SCOUT, { updateAvailable: { version: 4, packUrl: "packs/rent-scout.json" } }),
      ],
    });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const region = await screen.findByRole("region", { name: "Installed" });
    expect(within(region).getByText("Version 3")).toBeTruthy();
    expect(within(region).getByText("Version 4 available")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Update Rent Scout" })).toBeTruthy();
    // The browse card for an installed bot no longer offers Add.
    const browse = await screen.findByRole("region", { name: "Browse" });
    const card = await within(browse).findByRole("article", { name: "Rent Scout" });
    expect(within(card).queryByRole("button", { name: "Add Rent Scout" })).toBeNull();
    expect(within(card).getByText("Added")).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "Remove Rent Scout" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Rent Scout?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/api/bots/installed/rent-scout");
  });

  it("reads an update before applying it: what changes, then Update installs the pack shown", async () => {
    const v4 = { ...RENT_SCOUT, version: 4, hash: "c".repeat(64) };
    const mine = installedOf(RENT_SCOUT, {
      updateAvailable: { version: 4, packUrl: "packs/rent-scout.json" },
    });
    const { calls } = serve({
      installed: [mine],
      preview: previewOf(v4, {
        alreadyInstalled: mine,
        changes: [
          "New: it may read your mail without asking.",
          "Adds the rule “Ask before booking” (it asks first).",
        ],
      }),
    });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const region = await screen.findByRole("region", { name: "Installed" });
    fireEvent.click(within(region).getByRole("button", { name: "Update Rent Scout" }));
    const dialog = await screen.findByRole("dialog", { name: "Update Rent Scout" });
    const changes = await within(dialog).findByRole("region", { name: "What changes in version 4" });
    expect(within(changes).getByText("New: it may read your mail without asking.")).toBeTruthy();
    expect(within(changes).getByText(/Compared with version 3, which you have now/)).toBeTruthy();
    // Nothing was applied by opening it.
    expect(calls.some((c) => c.path === "/api/bots/install" || c.path.endsWith("/update"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Update to version 4" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/bots/install")).toBe(true));
    // The pack is fetched again by address, so the install names the one that was read.
    expect(calls.find((c) => c.path === "/api/bots/install")?.body).toEqual({
      packUrl: "packs/rent-scout.json",
      hash: "c".repeat(64),
    });
    expect(calls.some((c) => c.path.endsWith("/update"))).toBe(false);
  });

  it("names where an installed bot came from without showing a path on this machine", async () => {
    serve({
      installed: [
        installedOf(RENT_SCOUT),
        installedOf(INVOICE_CHASER, { source: "/home/someone/steward/directory/index.json" }),
      ],
    });
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const region = await screen.findByRole("region", { name: "Installed" });
    expect(await within(region).findByText(/from bots\.example/)).toBeTruthy();
    expect(within(region).getByText(/from the directory on this computer/)).toBeTruthy();
    expect(within(region).queryByText(/someone/)).toBeNull();
  });

  it("opens a listing from Add and shows what it may do before adding", async () => {
    const { calls } = serve();
    renderWithProviders(<BotsPage />, { route: "/bots" });
    const rent = await screen.findByRole("article", { name: "Rent Scout" });
    fireEvent.click(within(rent).getByRole("button", { name: "Add Rent Scout" }));
    const dialog = await screen.findByRole("dialog", { name: "Rent Scout" });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/bots/preview")).toBe(true));
    expect(calls.find((c) => c.path === "/api/bots/preview")?.body).toEqual({
      packUrl: "packs/rent-scout.json",
    });
    expect(await within(dialog).findByText("browse the web on its own computer")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to Steward" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/bots/install")).toBe(true));
    expect(calls.find((c) => c.path === "/api/bots/install")?.body).toEqual({
      packUrl: "packs/rent-scout.json",
      hash: RENT_SCOUT.hash,
    });
  });
});

describe("BotListingPage", () => {
  it("shows what it may do and what it asks before, from the preview", async () => {
    serve();
    renderWithProviders(
      <Routes>
        <Route path="/bots/:id" element={<BotListingPage />} />
      </Routes>,
      { route: "/bots/rent-scout" },
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Rent Scout" })).toBeTruthy();
    const mayDo = await screen.findByRole("region", { name: "What it may do without asking" });
    expect(within(mayDo).getByText("browse the web on its own computer")).toBeTruthy();
    expect(within(mayDo).getByText("read your mail")).toBeTruthy();
    const asks = screen.getByRole("region", { name: "What it asks before" });
    expect(within(asks).getByText("sending anything")).toBeTruthy();
    expect(within(asks).getByText("paying")).toBeTruthy();
    // The mail connector is not connected here, and the listing says so.
    const needs = screen.getByRole("region", { name: "What it needs" });
    expect(within(needs).getByText("Your mail")).toBeTruthy();
    expect(within(needs).getByText("Not connected")).toBeTruthy();
    // The README is markdown; the rule and the skill it brings are listed.
    expect(screen.getByText("reads the lease")).toBeTruthy();
    expect(screen.getByText("Never pay a deposit")).toBeTruthy();
    expect(screen.getByText("/find-rentals")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to Steward" })).toBeTruthy();
  });

  it("says there is no bot by that name when the directory has no pack for it", async () => {
    serve({ previewStatus: 404 });
    renderWithProviders(
      <Routes>
        <Route path="/bots/:id" element={<BotListingPage />} />
      </Routes>,
      { route: "/bots/does-not-exist" },
    );
    expect(await screen.findByRole("heading", { name: "No bot by that name" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("BotListingPage for a bot that is not there", () => {
  const draw = (route: string) =>
    renderWithProviders(
      <Routes>
        <Route path="/bots/:id" element={<BotListingPage />} />
      </Routes>,
      { route },
    );

  it("says there is no bot by that name when the directory has no pack for it", async () => {
    serve({ previewStatus: 404 });
    draw("/bots/does-not-exist");
    expect(await screen.findByRole("heading", { name: "No bot by that name" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for nothing when the address is not a bot's name at all", async () => {
    const { calls } = serve();
    draw(`/bots/${encodeURIComponent("../../secrets")}`);
    expect(await screen.findByRole("heading", { name: "No bot by that name" })).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/bots" || c.path === "/api/bots/preview")).toBe(false);
  });

  it("still names a real failure as one", async () => {
    serve({ previewStatus: 502 });
    draw("/bots/rent-scout");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Couldn't load this bot")).toBeTruthy();
  });
});

describe("BotAddPage", () => {
  function draw(address: string) {
    return renderWithProviders(
      <Routes>
        <Route
          path="/bots/add"
          element={
            <>
              <BotAddPage />
              <Where />
            </>
          }
        />
        <Route path="/chat" element={<Where />} />
      </Routes>,
      { route: `/bots/add?pack=${encodeURIComponent(address)}` },
    );
  }

  it("refuses a plain http address with a plain sentence, and fetches nothing", async () => {
    const { calls } = serve();
    draw("http://evil.example/packs/rent-scout.json");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText(/only adds bots from https addresses or from a file on this computer/),
    ).toBeTruthy();
    expect(screen.getByText(/http:\/\/evil\.example/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to Steward" })).toBeNull();
    expect(calls.filter((c) => c.path === "/api/bots/preview")).toHaveLength(0);
  });

  it("accepts a local path, says where the bot comes from, and goes to a new chat once added", async () => {
    const { calls } = serve();
    draw("/Users/sam/bots/rent-scout.json");
    expect(await screen.findByRole("heading", { level: 1, name: "Rent Scout" })).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/bots/preview")?.body).toEqual({
      packUrl: "/Users/sam/bots/rent-scout.json",
    });
    expect(screen.getByText("This bot comes from a file on this computer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to Steward" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/chat?agent=rent-scout"));
  });

  it("never offers Update for a pack older than the one the directory has", async () => {
    const v2 = { ...RENT_SCOUT, version: 2, hash: "d".repeat(64) };
    const mine = installedOf(RENT_SCOUT, {
      updateAvailable: { version: 4, packUrl: "packs/rent-scout.json" },
    });
    serve({ installed: [mine], preview: previewOf(v2, { alreadyInstalled: mine }) });
    draw("https://elsewhere.example/rent-scout.json");
    expect(await screen.findByRole("heading", { level: 1, name: "Rent Scout" })).toBeTruthy();
    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Update/ })).toBeNull();
    expect(screen.getByText(/Version 4 is in the directory/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read what changes" }).getAttribute("href")).toBe(
      "/bots/rent-scout",
    );
  });

  it("names the host of an https pack", async () => {
    serve();
    draw("https://bots.example/packs/rent-scout.json");
    expect(await screen.findByText("This bot comes from bots.example.")).toBeTruthy();
  });
});
