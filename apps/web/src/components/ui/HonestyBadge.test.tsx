import { render, screen } from "@testing-library/react";
import { HonestyBadge } from "./HonestyBadge";
import type { Health } from "@/lib/api";

const base: Health = { status: "ok", mode: "replay", demo: true, simulated: ["company", "rail data"], deploy: "cloud-gpu", region: "this machine + RunPod GPU", third_parties: ["elevenlabs"] };

test("the badge says when the AI is our own model on a GPU, and what is still recorded", () => {
  render(<HonestyBadge health={{ ...base, model: { kind: "runpod-vllm", name: "tempo-private", processor: "our own model on RunPod" } }} showcase={false} connected />);
  expect(screen.getAllByText(/SIMULATED company, rail data · AI: our own model on a RunPod GPU/).length).toBeGreaterThan(0);
});

test("without a real model the badge says nothing about AI", () => {
  render(<HonestyBadge health={{ ...base, simulated: ["company", "rail data", "jurors", "vision"], model: null }} showcase={false} connected />);
  expect(screen.queryByText(/our own model/)).toBeNull();
});
