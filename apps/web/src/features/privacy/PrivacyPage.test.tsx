import { render, screen } from "@testing-library/react";
import type { PrivacyProofData } from "@/lib/api";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import PrivacyPage, { recordedWords } from "./PrivacyPage";

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

test("the recorded proof names the outside companies and states its gaps plainly", async () => {
  const { container } = render(<main><PrivacyPage {...props()} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Privacy Proof" })).toBeInTheDocument();
  expect(await screen.findByText("cloud-standard")).toBeInTheDocument();
  expect(screen.getByText(/Cortex \(jurors\), ElevenLabs \(voice\), Gemini \(vision and a juror\)/)).toBeInTheDocument();
  expect(screen.getByText(/There is no signed allowlist yet/)).toBeInTheDocument();
  expect(screen.getByText(/no device yet/)).toBeInTheDocument();
  expect(screen.getByText(/nothing stored in the Vault yet/)).toBeInTheDocument();
  expect(screen.getAllByText("a gap").length).toBe(3);
  expect(screen.getByText("tests/integration/test_canary.py, on every commit in CI", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("The gaps are stated, not hidden.")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("a private deployment with a signed image and a paired device passes every line", async () => {
  const gateway = new ShowcaseGateway();
  const proof: PrivacyProofData = {
    mode: "cloud-private",
    region: "eu (RunPod Secure Cloud)",
    third_parties: [],
    image_digest: `sha256:${"ab".repeat(32)}`,
    allowlist: "signed",
    image_allowlisted: true,
    key_held_on: ["Margaret's iPhone"],
    operator_view: { table: "vault_blobs", bytes: "9f3c0a7e" },
    canary_test: "tests/integration/test_canary.py, on every commit in CI",
    attestation: "n/a",
  };
  gateway.privacy = async () => proof;
  render(<main><PrivacyPage {...props({ gateway, showcase: false })} /></main>);

  expect(await screen.findByText(/^none/)).toHaveTextContent("in private mode nothing leaves the deployment");
  expect(screen.getByText(/on the allowlist signed by Tempo's deploy key/)).toBeInTheDocument();
  expect(screen.getByText(/Margaret's iPhone/)).toBeInTheDocument();
  expect(screen.getByLabelText("Operator view of one stored row")).toHaveTextContent("vault_blobs: 9f3c0a7e…");
  expect(screen.getAllByText("checked").length).toBe(5);
});

test("the outside-AI line follows what the Gateway says answers from recordings, not the mode alone", () => {
  expect(recordedWords(["company", "rail data", "jurors", "vision"])).toMatch(/named but not called: the jurors and vision answer from recordings/);
  expect(recordedWords(["company", "rail data"])).toMatch(/^They are called for real in this run\./);
  expect(recordedWords(["company", "rail data", "vision"])).toMatch(/^In this run vision answers from recordings; the rest is called for real\./);
  expect(recordedWords(undefined)).toMatch(/^They are called for real/);
});
