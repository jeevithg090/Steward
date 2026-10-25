import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportProfile } from "@/components/site/ImportProfile";
import { SiteChrome } from "@/components/site/SiteChrome";
import { CatalogClient } from "@/lib/catalog-client";
import { encodeShareCode, toProfile } from "@/lib/profiles";
import { ShowcaseCatalog } from "@/lib/showcase";
import { expectNoA11yViolations } from "./a11y";

const source = new ShowcaseCatalog();

async function code(id = "new-to-the-uk"): Promise<string> {
  return encodeShareCode(toProfile(await source.profile(id)));
}

test("a valid share code opens the profile, labelled as not yet checked by a Gateway", async () => {
  const { container } = render(
    <SiteChrome pathname="/profiles/import"><ImportProfile source={source} hash={`#p=${await code()}`} /></SiteChrome>,
  );

  expect(await screen.findByRole("heading", { level: 2, name: "New Here" })).toBeInTheDocument();
  expect(screen.getByText("Not yet checked by a Gateway")).toBeInTheDocument();
  expect(screen.getByText("Hindi")).toBeInTheDocument();
  expect(screen.getByText(/Work out the UK261 band/)).toBeInTheDocument(); // jobs from the manifests
  expect(screen.getByText(/This page has stored nothing/)).toBeInTheDocument();
  expect(window.localStorage.length).toBe(0);
  await expectNoA11yViolations(container);
});

test("a tampered code is refused with the reason", async () => {
  const good = await code();
  const tampered = good.slice(0, -6) + "AAAAAA"; // the tail of the base64url changed

  const { container } = render(<SiteChrome pathname="/profiles/import"><ImportProfile source={source} hash={`#p=${tampered}`} /></SiteChrome>);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This code can't be trusted");
  expect(alert).toHaveTextContent(/changed or cut short|isn't part of|should be/);
  expect(screen.queryByText("New Here")).not.toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("a code whose profile breaks a rule is refused even though it decodes", async () => {
  const profile = toProfile(await source.profile("commuter"));
  const overlapping = encodeShareCode({ ...profile, may_not: [...profile.may_not, "claim"] });

  render(<ImportProfile source={source} hash={`#p=${overlapping}`} />);

  expect(await screen.findByRole("alert")).toHaveTextContent('"claim" is in both "may" and "may_not"');
});

test("without a code, a pasted link is checked; the wrong prefix is refused", async () => {
  render(<ImportProfile source={source} hash="" />);

  await userEvent.type(screen.getByLabelText("Paste a share link or code"), "hello.world");
  await userEvent.click(screen.getByRole("button", { name: "Check it" }));

  expect(await screen.findByRole("alert")).toHaveTextContent('A Tempo share code starts with "tp1."');
  await userEvent.click(screen.getByRole("button", { name: "Try another code" }));
  expect(screen.getByLabelText("Paste a share link or code")).toBeInTheDocument();
});

test("with a Gateway, the code is posted to /profiles/import and its 422 reason is shown", async () => {
  const calls: { url: string; body: string }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(JSON.stringify({ detail: "skill 'x' is not known" }), { status: 422 });
  }) as typeof fetch;
  const gateway = new CatalogClient({ url: "http://gw.test", token: "t0k" }, fake);
  const shared = await code();

  render(<ImportProfile source={gateway} hash={`#p=${shared}`} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("skill 'x' is not known");
  expect(calls[0]!.url).toBe("http://gw.test/profiles/import");
  expect(JSON.parse(calls[0]!.body)).toEqual({ code: shared });
});

test("with a Gateway that is down, the profile is shown but labelled unchecked", async () => {
  const fake = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const gateway = new CatalogClient({ url: "http://gw.test", token: "t0k" }, fake);

  render(<ImportProfile source={gateway} hash={`#p=${await code("carer")}`} />);

  expect(await screen.findByRole("heading", { level: 2, name: "The Carer" })).toBeInTheDocument();
  expect(screen.getByText("Not yet checked by a Gateway")).toBeInTheDocument();
  expect(screen.getByText(/No Gateway answered/)).toBeInTheDocument();
});
