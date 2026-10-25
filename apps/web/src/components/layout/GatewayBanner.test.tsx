import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { GatewayBanner } from "./GatewayBanner";

test("on this machine it says how to start the Gateway", () => {
  render(<GatewayBanner url="http://127.0.0.1:8000" onRetry={() => undefined} onShowcase={() => undefined} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/Start it with make demo/);
});

test("on a hosted page it speaks plainly and lets a long address wrap", async () => {
  const url = "https://supply-mandate-garlic-enclosure.trycloudflare.com";
  const { container } = render(
    <main>
      <GatewayBanner url={url} onRetry={() => undefined} onShowcase={() => undefined} />
    </main>,
  );
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(/It may be restarting: try again in a moment/);
  expect(alert).not.toHaveTextContent(/make demo/);
  expect(screen.getByText(url)).toHaveClass("break-all");
  await expectNoA11yViolations(container);
});
