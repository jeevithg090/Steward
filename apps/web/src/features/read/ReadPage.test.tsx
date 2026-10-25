import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "@/components/ui";
import { GatewayError } from "@/lib/catalog-client";
import type { LettersFixture } from "@/lib/letters";
import { ShowcaseCatalog, ShowcaseGateway } from "@/lib/showcase";
import lettersJson from "@/showcase/letters.json";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ReadPage, { readFailure } from "./ReadPage";
import { SAMPLE_PHOTOS, SHOWCASE_CANNOT_READ, sha256Hex, toBase64, withRecordedVision } from "./samples";

const png = (file: string) => new Uint8Array(readFileSync(resolve(__dirname, "../../../public/demo", file)));
const letters = (lettersJson as unknown as LettersFixture).letters;

/** Serves the sample photos from public/demo/, and `POST /letters/read` as `onRead` says. */
function fakeFetch(onRead: (body: Record<string, string>) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const photo = SAMPLE_PHOTOS.find((p) => url.endsWith(`/demo/${p.file}`));
    if (photo) return new Response(png(photo.file), { status: 200, headers: { "Content-Type": "image/png" } });
    if (url.endsWith("/letters/read")) return onRead(JSON.parse(String(init?.body)) as Record<string, string>);
    return new Response("{}", { status: 404 });
  });
}

function props(over: Partial<PageProps> = {}): PageProps {
  return {
    gateway: new ShowcaseGateway(),
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: true,
    health: null,
    events: [],
    language: "en",
    params: {},
    speak: vi.fn(),
    setProfile: vi.fn(),
    ...over,
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  toast.clear();
});

test("the sample photos in public/demo are the fixtures the Gateway's replay vision knows by their SHA-256", async () => {
  for (const photo of SAMPLE_PHOTOS) {
    expect(await sha256Hex(png(photo.file))).toBe(photo.sha256);
    expect(letters.some((l) => l.id === photo.id)).toBe(true);
  }
});

test("live: pressing a sample photo fetches the PNG and sends it to the Gateway's vision path as base64, then reads the answer aloud", async () => {
  const council = letters.find((l) => l.id === "council-tax-reminder")!.reading;
  const seen: Record<string, string>[] = [];
  globalThis.fetch = fakeFetch((body) => {
    seen.push(body);
    return new Response(JSON.stringify(council), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const speak = vi.fn();
  const health = { status: "ok", mode: "replay" as const, demo: true, simulated: ["company", "vision"], deploy: "local", region: "eu", third_parties: [] };
  const { container } = render(<main><ReadPage {...props({ speak, showcase: false, health })} /></main>);

  expect(screen.getByLabelText(/Take a photo of the letter/)).toHaveAttribute("type", "file");
  expect(screen.getByText(/Your own photo needs a Gemini key on the Gateway, and this one is in replay mode/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /A council tax reminder/ }));

  expect(await screen.findByRole("heading", { name: "A council tax letter from Oxford City Council, dated 20 October 2026" })).toBeInTheDocument();
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ filename: "council_tax_reminder.png", user_id: "u_margaret", image_b64: toBase64(png("council_tax_reminder.png")) });
  expect(seen[0]!.image_b64.length).toBeGreaterThan(70_000);
  expect(screen.getByText("Read by your Gateway")).toBeInTheDocument();
  expect(screen.getByText(/recognised by its fingerprint/)).toBeInTheDocument();
  expect(speak).toHaveBeenCalledWith(expect.stringMatching(/^This is a council tax letter from Oxford City Council/));
  expect(screen.getByRole("button", { name: /A council tax reminder/ })).toHaveAttribute("aria-pressed", "true");
  await expectNoA11yViolations(container);
});

test("live: an own photo the Gateway can't read shows its plain message and points to the samples", async () => {
  globalThis.fetch = fakeFetch(() => new Response(JSON.stringify({ detail: "I couldn't read that letter. Try a clearer photo, or tell me what it says." }), { status: 503 })) as typeof fetch;
  render(<main><ReadPage {...props({ showcase: false })} /></main>);

  const file = new File([new Uint8Array([137, 80, 78, 71])], "my-letter.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText(/Take a photo of the letter/), file);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("I couldn't read that letter. Try a clearer photo, or tell me what it says. The two sample photos below always work.");
  expect(readFailure(new GatewayError(401, "no"), false)).toMatch(/token in Settings/);
  expect(readFailure(new TypeError("Failed to fetch"), false)).toMatch(/Can't reach your Tempo Gateway/);
});

test("showcase: the council photo is recognised by its fingerprint and read back with its one read-back question first; the avatar reads it aloud", async () => {
  globalThis.fetch = fakeFetch(() => new Response("{}", { status: 500 })) as typeof fetch;
  const speak = vi.fn();
  const { container } = render(<main><ReadPage {...props({ speak })} /><Toaster /></main>);
  expect(screen.getByRole("heading", { level: 1, name: "Read It To Me" })).toBeInTheDocument();
  expect(screen.getByText(/no Gateway to read a new letter/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Take a photo/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /A council tax reminder/ }));

  expect(await screen.findByRole("heading", { name: "A council tax letter from Oxford City Council, dated 20 October 2026" })).toBeInTheDocument();
  expect(screen.getByText("It says you owe Oxford City Council £112.00.")).toBeInTheDocument();
  expect(screen.getByText("Money is owed by you: £112.00")).toBeInTheDocument();
  expect(screen.getByText(/By 10 November 2026\./)).toBeInTheDocument();
  expect(screen.getByText("Recorded from the replay Gateway")).toBeInTheDocument();
  expect(speak).toHaveBeenCalledTimes(1);

  const unsure = screen.getByRole("group", { name: "Before I go on, one thing I wasn't sure of" });
  expect(within(unsure).getByText("I read the date to pay by as 10 November 2026. Is that right?")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Read it to me" }));
  expect(speak).toHaveBeenLastCalledWith(expect.stringMatching(/^This is a council tax letter from Oxford City Council, dated 20 October 2026/));

  await userEvent.click(within(unsure).getByRole("button", { name: "Yes, that's right" }));
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();
  expect(await screen.findByText("Thank you. Tempo keeps that date.")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("correcting the read-back date changes the date shown", async () => {
  globalThis.fetch = fakeFetch(() => new Response("{}", { status: 500 })) as typeof fetch;
  render(<main><ReadPage {...props()} /></main>);
  await userEvent.click(screen.getByRole("button", { name: /A council tax reminder/ }));

  const unsure = await screen.findByRole("group", { name: /Before I go on/ });
  await userEvent.type(within(unsure).getByLabelText("Or the right one"), "2026-11-12");
  await userEvent.click(within(unsure).getByRole("button", { name: "Use this" }));

  expect(screen.getByText(/By 12 November 2026\./)).toBeInTheDocument();
});

test("the water letter says Thames Water owes you £23.40; a reply is drafted from your words only and can be copied", async () => {
  globalThis.fetch = fakeFetch(() => new Response("{}", { status: 500 })) as typeof fetch;
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  render(<main><ReadPage {...props()} /><Toaster /></main>);

  await userEvent.click(screen.getByRole("button", { name: /A water bill: you paid too much/ }));
  expect(await screen.findByRole("heading", { name: "A water bill from Thames Water, dated 3 October 2026" })).toBeInTheDocument();
  expect(screen.getByText("Money is coming to you: £23.40")).toBeInTheDocument();
  expect(screen.getByText("There is nothing you need to do.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("What do you want to say?"), "Please send the credit back to my bank account.");
  await userEvent.click(screen.getByRole("button", { name: "Draft my reply" }));

  const draft = await screen.findByText(/Dear Thames Water/);
  expect(draft).toHaveTextContent("your letter of 3 October 2026, which I understand is a water bill.");
  expect(draft).toHaveTextContent("Please send the credit back to my bank account.");
  expect(draft).toHaveTextContent("Margaret");
  expect(screen.getByText(/Made from your words and this reading only/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Dear Thames Water"));
  expect(await screen.findByText(/Copied\. Read it once more/)).toBeInTheDocument();
});

test("showcase vision refuses any photo that is not a sample, in plain words", async () => {
  const source = withRecordedVision(new ShowcaseCatalog());
  await expect(source.readLetter({ image_b64: toBase64(new Uint8Array([1, 2, 3])), filename: "mine.png" })).rejects.toThrow(SHOWCASE_CANNOT_READ);
  const water = await source.readLetter({ image_b64: toBase64(png("thames_water_overpayment.png")), filename: "renamed.png" });
  expect(water.sender).toBe("Thames Water");
});
