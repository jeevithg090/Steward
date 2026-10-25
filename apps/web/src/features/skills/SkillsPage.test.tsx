import { render, screen } from "@testing-library/react";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import { SAY, chatSay } from "../story/demo";
import SkillsPage, { TRY_SKILL } from "./SkillsPage";

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

test("the skills page lists every manifest with its status in plain words, what it needs, and how to add one", async () => {
  const { container } = render(<main><SkillsPage {...props()} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Skills" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Delay Repay for UK trains" })).toBeInTheDocument();
  expect(document.getElementById("rights-decay")).not.toBeNull();
  expect(screen.getAllByText("demo values: not yet checked against the published terms").length).toBe(5);
  expect(screen.getAllByText("ready").length).toBe(2);
  expect(screen.getAllByText("nothing binding: it only reads, explains and warns").length).toBe(4);
  expect(screen.getAllByText("claim money for you").length).toBeGreaterThan(0);
  expect(screen.getByText("GWR, Chiltern")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /docs\/add-a-usecase\.md on GitHub/ })).toHaveAttribute("href", "https://github.com/jeevithg090/Tempo/blob/main/docs/add-a-usecase.md");
  expect(screen.getByText("One YAML rule pack")).toBeInTheDocument();
  expect(screen.getByText("A skill folder")).toBeInTheDocument();
  expect(screen.getByText("A mission in Python")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("skills that can be tried link straight to the chat with a sentence that fits, or to their page", async () => {
  render(<main><SkillsPage {...props()} /></main>);
  expect(screen.getByRole("status", { name: "Loading skills" })).toBeInTheDocument();

  expect(await screen.findByRole("link", { name: "Try it: Delay Repay for UK trains" })).toHaveAttribute("href", chatSay(SAY.lateTrain));
  expect(screen.getByRole("link", { name: "Try it: Missed engineer visits and broadband faults" })).toHaveAttribute("href", chatSay(SAY.broadband));
  expect(screen.getByRole("link", { name: "Try it: Scam Shield" })).toHaveAttribute("href", chatSay(SAY.scam));
  expect(screen.getByRole("link", { name: "Try it: Entitlement Check" })).toHaveAttribute("href", "#/chat?say=Am%20I%20owed%20anything%3F");
  expect(screen.getByRole("link", { name: "Try it: Letter Explainer and Decision Challenger" })).toHaveAttribute("href", "#/read");
  expect(screen.queryByRole("link", { name: /Try it: Rights Decay/ })).not.toBeInTheDocument();
  expect(Object.keys(TRY_SKILL)).toHaveLength(5);
});
