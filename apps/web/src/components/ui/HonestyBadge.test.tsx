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

test("when the model's last call failed, the badge says it is not answering yet", () => {
  render(<HonestyBadge health={{ ...base, model: { kind: "runpod-vllm", name: "tempo-private", processor: "our own model on RunPod", answering: false } }} showcase={false} connected />);
  expect(screen.getAllByText(/AI: our own model on a RunPod GPU \(not answering yet\)/).length).toBeGreaterThan(0);
});

test("the API fallback names its providers", () => {
  render(<HonestyBadge health={{ ...base, deploy: "cloud-apis", model: { kind: "apis", name: "gemini-3.1-flash-lite", processor: "Google Gemini and OpenRouter", answering: true } }} showcase={false} connected />);
  expect(screen.getAllByText(/AI: Google Gemini and OpenRouter/).length).toBeGreaterThan(0);
});
