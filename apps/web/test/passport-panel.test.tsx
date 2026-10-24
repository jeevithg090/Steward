import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PassportPanel } from "@/components/PassportPanel";
import type { MandateView } from "@/lib/api";

const MANDATE: MandateView = {
  id: "md_1", status: "active", counterparty: "Broadbandly", may: ["claim", "accept_cash"],
  may_not: ["accept_voucher", "discuss_other_accounts"], max_gbp: "32.31",
  expires_at: "2026-10-26T08:00:00Z", account_ref: "****4417", assurance: "device-biometric",
  digest: "0052b34e13d52e1c60676125af0e1f43",
};
const noop = () => {};

test("the card shows what Tempo may and may not do, and how it was signed", () => {
  render(<PassportPanel mandate={MANDATE} events={[]} canIssue busy={false} onIssue={noop} onRevoke={noop} />);

  expect(screen.getByRole("status")).toHaveTextContent("active");
  expect(screen.getByText("For Broadbandly, account ****4417")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Tempo may" })).toHaveTextContent("may claim");
  expect(screen.getByRole("list", { name: "Tempo may not" })).toHaveTextContent("not take vouchers");
  expect(screen.getByText(/Signed with Face ID/)).toHaveTextContent("fingerprint 0052b34e13d5");
});

test("every check the company made is listed, refusals with the reason", () => {
  const events = [
    { type: "mandate_refused", action: "discuss_other_accounts", reason: "action_not_allowed", latency_ms: 0.08 },
    { type: "mandate_verified", action: "claim", reason: "ok", latency_ms: 0.07 },
  ];
  render(<PassportPanel mandate={MANDATE} events={events} canIssue busy={false} onIssue={noop} onRevoke={noop} />);

  expect(screen.getByText(/Refused: other accounts \(action not allowed\)/)).toBeInTheDocument();
  expect(screen.getByText(/Allowed: claim · 0.07 ms/)).toBeInTheDocument();
});

test("revoking calls back with the id; without a mandate it offers Face ID", async () => {
  const revoked: string[] = [];
  const { rerender } = render(
    <PassportPanel mandate={MANDATE} events={[]} canIssue busy={false} onIssue={noop} onRevoke={(id) => revoked.push(id)} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel this mandate" }));
  expect(revoked).toEqual(["md_1"]);

  rerender(<PassportPanel mandate={null} events={[]} canIssue={false} busy={false} onIssue={noop} onRevoke={noop} />);
  expect(screen.getByText(/Add Face ID or a fingerprint/)).toBeInTheDocument();
});
