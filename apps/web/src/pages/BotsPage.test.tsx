import type { AppInfo } from "@steward/shared";
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
  } = {},
) {
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/info")
      return { body: { ...INFO, mail: { ...INFO.mail, connected: opts.mailConnected ?? false } } };
    if (req.path === "/api/bots" && req.method === "GET") {
      const q = req.query.get("q")?.toLowerCase();
      const category = req.query.get("category");
      const bots = LISTINGS.filter(
        (bot) =>
          (!q || `${bot.id} ${bot.name}`.toLowerCase().includes(q)) &&
          (!category || bot.category === category),
      );
      return {
        body: { bots, total: bots.length, categories: { home: "Home & family", money: "Money & finance" } },
      };
    }
    if (req.path === "/api/bots/installed") return { body: opts.installed ?? [] };
    if (req.path === "/api/bots/preview" && req.method === "POST") {
      if (opts.previewStatus)
        return { status: opts.previewStatus, body: { error: "Couldn't fetch that pack." } };
      const body = req.body as { packUrl?: string; pack?: { id: string } };
      const id = body.pack?.id ?? body.packUrl?.match(/([a-z-]+)\.json$/)?.[1];
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

  it("names the host of an https pack", async () => {
    serve();
    draw("https://bots.example/packs/rent-scout.json");
    expect(await screen.findByText("This bot comes from bots.example.")).toBeTruthy();
  });
});
