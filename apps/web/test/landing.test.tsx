import { render, screen, waitFor, within } from "@testing-library/react";
import { BEATS, FORGOTTEN, Landing } from "@/components/site/Landing";
import { PairRedirect } from "@/components/site/PairRedirect";
import { SiteChrome } from "@/components/site/SiteChrome";
import { expectNoA11yViolations } from "./a11y";

const ledger = async () => ({ minutes_returned: "20", hours_returned: "0.3", gbp_recovered: "28.40" });

test("the landing tells the ten beats in order, names the four needs, and links into the product", async () => {
  const { container } = render(
    <SiteChrome pathname="/"><Landing gateway={{ ledger }} /></SiteChrome>,
  );

  expect(screen.getByRole("heading", { level: 1, name: "Your time, returned." })).toBeInTheDocument();
  const beats = within(screen.getByRole("region", { name: "One fact runs through everything" })).getAllByRole("listitem");
  expect(beats.map((li) => within(li).getByRole("heading", { level: 3 }).textContent)).toEqual(BEATS.map((b) => b.name));
  expect(BEATS).toHaveLength(10);

  const forgotten = screen.getByRole("region", { name: "The people the internet forgot" });
  expect(within(forgotten).getAllByRole("heading", { level: 3 })).toHaveLength(4);
  expect(FORGOTTEN.find((f) => f.need.includes("scammers"))?.href).toBe("/shield");
  expect(within(forgotten).getByRole("link", { name: "Check a message with Scam Shield" })).toHaveAttribute("href", "/shield");

  expect(screen.getByRole("link", { name: "Watch Margaret's claim" })).toHaveAttribute("href", "/control");
  expect(screen.getByRole("link", { name: "Pick a profile" })).toHaveAttribute("href", "/profiles");
  expect(screen.getByRole("link", { name: "Read a letter to me" })).toHaveAttribute("href", "/read");
  expect(screen.getAllByRole("link", { name: /Add your use case/ })[0]).toHaveAttribute(
    "href", "https://github.com/jeevithg090/Tempo/blob/main/docs/add-a-usecase.md",
  );
  expect(screen.getAllByRole("link", { name: /How we keep it safe/ })[0]).toHaveAttribute(
    "href", "https://github.com/jeevithg090/Tempo/blob/main/docs/security.md",
  );

  expect(await screen.findByText("0.3")).toBeInTheDocument();
  expect(screen.getByText("£28.40")).toBeInTheDocument();
  expect(screen.getByText(/Rights Decay's curves are NYC 311/)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("when no Gateway answers, the counters say so and point at the showcase", async () => {
  render(<Landing gateway={{ ledger: async () => { throw new Error("ECONNREFUSED"); } }} />);

  expect(await screen.findByText(/No Gateway is answering/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the recorded showcase" })).toHaveAttribute("href", "/?showcase=1");
});

test("a device-pairing link opened at / is handed to /control with its fragment intact", async () => {
  window.history.replaceState({}, "", "/#pair=p_abc123.s3cr3t");
  const navigate = vi.fn();
  render(<PairRedirect navigate={navigate} />);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/control#pair=p_abc123.s3cr3t"));
  window.history.replaceState({}, "", "/");
});

test("an ordinary visit to / is not redirected", async () => {
  window.history.replaceState({}, "", "/");
  const navigate = vi.fn();
  render(<PairRedirect navigate={navigate} />);

  await new Promise((r) => setTimeout(r, 10));
  expect(navigate).not.toHaveBeenCalled();
});
