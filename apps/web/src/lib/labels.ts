import type { MissionState } from "@/lib/api";

export const STATE_LABELS: Record<MissionState, string> = {
  received: "Received",
  understood: "Understood the journey",
  planned: "Worked out the entitlement",
  appraised: "Checked it's worth your time",
  declined: "Declined",
  awaiting_consent: "Waiting for your OK",
  running: "Acting for you",
  checkpoint: "Needs a decision",
  waiting: "Waiting for the company",
  completed: "Claim resolved",
  failed_safe: "Stopped safely",
  verified: "Money arrived",
};
