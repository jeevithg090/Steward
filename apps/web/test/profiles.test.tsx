import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileDetail } from "@/components/site/ProfileDetail";
import { ProfilesPage } from "@/components/site/ProfilesPage";
import { SiteChrome } from "@/components/site/SiteChrome";
import { SkillsPage } from "@/components/site/SkillsPage";
import { ACTIONS, type Profile, ProfileInvalid, decodeShareCode, encodeShareCode, profileToYaml, toProfile, unionJobs, validateProfile } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { expectNoA11yViolations } from "./a11y";

const source = new ShowcaseCatalog();

test("the profiles list says who each is for, what it will do, what it may never do, and how it speaks", async () => {
  const { container } = render(<SiteChrome pathname="/profiles"><ProfilesPage source={source} /></SiteChrome>);

  expect(await screen.findByRole("link", { name: "The Commuter" })).toHaveAttribute("href", "/profiles/commuter");
  expect(screen.getByRole("link", { name: "Read It To Me" })).toHaveAttribute("href", "/profiles/read-it-to-me");
  const chips = screen.getAllByRole("list", { name: "How Tempo speaks with you" });
  expect(chips.some((list) => within(list).queryByText("Hindi") && within(list).queryByText("slower"))).toBe(true);
  expect(screen.getAllByText("Accept vouchers instead of cash").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("heading", { name: "What this profile will do for you" })).toHaveLength(7);
  await expectNoA11yViolations(container);
});

test("a profile's detail shows the union of its skills' jobs, its limits in words and a share link", async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  const { container } = render(<SiteChrome pathname="/profiles/read-it-to-me"><ProfileDetail id="read-it-to-me" source={source} /></SiteChrome>);

  expect(await screen.findByRole("heading", { level: 1, name: "Read It To Me" })).toBeInTheDocument();
  const profile = await source.profile("read-it-to-me");
  expect(profile.jobs).toEqual(unionJobs(profile.skills));
  expect(screen.getByText("It never claims money: £0.00 a claim.")).toBeInTheDocument();
  expect(screen.getByText("Claim money for you")).toBeInTheDocument(); // in "may never do"
  expect(screen.getByRole("link", { name: "Letter Explainer and Decision Challenger" })).toHaveAttribute("href", "/skills#letter-explainer");

  const link = (await screen.findByLabelText("The link")) as HTMLTextAreaElement;
  expect(link.value).toMatch(/\/profiles\/import#p=tp1\./);
  expect(decodeShareCode(link.value.split("#p=")[1]!).id).toBe("read-it-to-me");

  await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.value);
  expect(await screen.findByText(/Link copied/)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("an unknown profile says so", async () => {
  render(<ProfileDetail id="nobody" source={source} />);

  expect(await screen.findByRole("alert")).toHaveTextContent('There\'s no profile called "nobody".');
});

test("the skills page lists every manifest with its status in plain words", async () => {
  const { container } = render(<SiteChrome pathname="/skills"><SkillsPage source={source} /></SiteChrome>);

  expect(await screen.findByRole("heading", { name: "Delay Repay for UK trains" })).toBeInTheDocument();
  expect(document.getElementById("rights-decay")).not.toBeNull();
  expect(screen.getAllByText("demo values: not yet checked against the published terms").length).toBeGreaterThan(0);
  expect(screen.getAllByText("nothing binding: it only reads, explains and warns").length).toBeGreaterThan(0);
  await expectNoA11yViolations(container);
});

test("share codes round-trip and the YAML download is the committed file", async () => {
  const view = await source.profile("commuter");
  const profile = toProfile(view);
  const code = encodeShareCode(profile);

  expect(code.startsWith("tp1.")).toBe(true);
  expect(decodeShareCode(code, await source.skills())).toEqual(profile);
  expect(profileToYaml(view)).toContain("id: commuter");
  expect(profileToYaml({ ...view, yaml: undefined })).toContain("may_not: [accept_voucher, call, discuss_other_accounts, change_contract, share_personal_data]");
});

test("validation refuses what the Gateway would refuse, with a plain reason", async () => {
  const good = toProfile(await source.profile("commuter"));
  const manifests = await source.skills();
  const reason = (p: unknown) => {
    try {
      validateProfile(p, manifests);
      return null;
    } catch (e) {
      return e instanceof ProfileInvalid ? e.reason : String(e);
    }
  };

  expect(reason(good)).toBeNull();
  expect(reason({ ...good, may_not: [...good.may_not, "claim"] })).toMatch(/"claim" is in both/);
  expect(reason({ ...good, may: ["teleport"] })).toMatch(/isn't a capability/);
  expect(reason({ ...good, skills: ["clawback-uk-rail"], may: [] })).toMatch(/needs "claim"/);
  expect(reason({ ...good, skills: ["made-up"] })).toMatch(/isn't a skill Tempo has/);
  expect(reason({ ...good, extra: true })).toMatch(/isn't part of a profile/);
  expect(reason({ ...good, limits: { ...good.limits, max_user_questions: 11 } })).toMatch(/whole number from 1 to 10/);
  expect(reason({ ...good, limits: { ...good.limits, max_gbp_per_claim: 250 } })).toMatch(/amount like/);
  expect(ACTIONS).toHaveLength(8);
  expect((good satisfies Profile).id).toBe("commuter");
});
