import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeShareCode, encodeShareCode, toProfile } from "@/lib/profiles";
import { ShowcaseCatalog, ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ProfilesPage, { codeFrom, importUrl } from "./ProfilesPage";

const catalog = new ShowcaseCatalog();

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

async function code(id = "new-to-the-uk"): Promise<string> {
  return encodeShareCode(toProfile(await catalog.profile(id)));
}

afterEach(() => {
  window.location.hash = "";
});

test("the catalogue says who each profile is for, what it will and may never do, and lets Margaret pick one", async () => {
  window.location.hash = "#/profiles";
  const setProfile = vi.fn();
  const { container } = render(<main><ProfilesPage {...props({ setProfile })} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Profiles" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "The Commuter" })).toHaveAttribute("href", "#/profiles/commuter");
  expect(screen.getByRole("link", { name: "Read It To Me" })).toHaveAttribute("href", "#/profiles/read-it-to-me");
  expect(screen.getAllByRole("heading", { name: "What this profile will do for you" })).toHaveLength(7);
  expect(screen.getAllByText("Accept vouchers instead of cash").length).toBeGreaterThan(0);
  const chips = screen.getAllByRole("list", { name: "How Tempo speaks with you" });
  expect(chips.some((list) => within(list).queryByText("Hindi") && within(list).queryByText("slower"))).toBe(true);

  await userEvent.click(screen.getAllByRole("button", { name: "Use this profile" })[0]!);
  expect(setProfile).toHaveBeenCalledWith("am-i-owed");
  await expectNoA11yViolations(container);
});

test("the profile in use is marked, and can be stopped", async () => {
  window.location.hash = "#/profiles";
  const setProfile = vi.fn();
  render(<main><ProfilesPage {...props({ setProfile, user: { id: "u_margaret", name: "Margaret", profileId: "commuter" } })} /></main>);

  expect(await screen.findByText(/Tempo is working for you as/)).toHaveTextContent("The Commuter");
  expect(screen.getAllByText("In use").length).toBeGreaterThan(0);
  await userEvent.click(screen.getAllByRole("button", { name: "Stop using" })[0]!);
  expect(setProfile).toHaveBeenCalledWith(null);
});

test("a profile's detail shows its limits in words, what it may never do, and a share link that carries the whole profile", async () => {
  window.location.hash = "#/profiles/read-it-to-me";
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  const { container } = render(<main><ProfilesPage {...props({ params: { id: "read-it-to-me" } })} /></main>);

  expect(await screen.findByRole("heading", { level: 2, name: "Read It To Me" })).toBeInTheDocument();
  expect(screen.getByText("It never claims money: £0.00 a claim.")).toBeInTheDocument();
  expect(screen.getByText("Claim money for you")).toBeInTheDocument();

  const link = (await screen.findByLabelText("The link")) as HTMLTextAreaElement;
  expect(link.value).toMatch(/#\/profiles\/import\?p=tp1\./);
  expect(decodeShareCode(codeFrom(link.value)).id).toBe("read-it-to-me");

  await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.value);
  expect(await screen.findByText(/Link copied/)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("an unknown profile says so", async () => {
  window.location.hash = "#/profiles/nobody";
  render(<main><ProfilesPage {...props({ params: { id: "nobody" } })} /></main>);

  expect(await screen.findByRole("alert")).toHaveTextContent('There\'s no profile called "nobody".');
});

test("a bad share code is refused with a plain reason, and nothing is shown or stored", async () => {
  window.location.hash = "#/profiles/import?p=hello.world";
  const { container } = render(<main><ProfilesPage {...props()} /></main>);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This code can't be trusted.");
  expect(alert).toHaveTextContent('A Tempo share code starts with "tp1.".');
  expect(screen.queryByText("New Here")).not.toBeInTheDocument();
  expect(window.localStorage.length).toBe(0);
  await expectNoA11yViolations(container);
});

test("a tampered code and a code whose profile breaks a rule are both refused", async () => {
  const good = await code();
  window.location.hash = `#/profiles/import?p=${good.slice(0, -6)}AAAAAA`;
  const { unmount } = render(<main><ProfilesPage {...props()} /></main>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed or cut short|isn't part of|should be|doesn't hold/);
  unmount();

  const profile = toProfile(await catalog.profile("commuter"));
  window.location.hash = `#/profiles/import?p=${encodeShareCode({ ...profile, may_not: [...profile.may_not, "claim"] })}`;
  render(<main><ProfilesPage {...props()} /></main>);
  expect(await screen.findByRole("alert")).toHaveTextContent('"claim" is in both "may" and "may_not"');
});

test("a valid code opens the profile, labelled as checked in the browser only, and it can be used because the catalogue has it", async () => {
  window.location.hash = `#/profiles/import?p=${await code()}`;
  const setProfile = vi.fn();
  render(<main><ProfilesPage {...props({ setProfile })} /></main>);

  expect(await screen.findByRole("heading", { level: 3, name: "New Here" })).toBeInTheDocument();
  expect(screen.getByText("Not yet checked by a Gateway")).toBeInTheDocument();
  expect(screen.getByText(/only ever validates: it never stores/)).toBeInTheDocument();
  expect(screen.getByText(/Work out the UK261 band/)).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Use this profile" }));
  expect(setProfile).toHaveBeenCalledWith("new-to-the-uk");
  expect(screen.getByText("This page has stored nothing.")).toBeInTheDocument();
});

test("a pasted link is checked; the import URL keeps the code in the hash's query", async () => {
  window.location.hash = "#/profiles/import";
  render(<main><ProfilesPage {...props()} /></main>);

  const url = importUrl(toProfile(await catalog.profile("carer")));
  expect(url).toMatch(/#\/profiles\/import\?p=tp1\./);
  await userEvent.click(screen.getByLabelText("Paste a share link or code"));
  await userEvent.paste(url);
  await userEvent.click(screen.getByRole("button", { name: "Check it" }));

  expect(await screen.findByRole("heading", { level: 3, name: "The Carer" })).toBeInTheDocument();
  expect(codeFrom("https://tempo.example/profiles/import#p=tp1.abc")).toBe("tp1.abc");
});
