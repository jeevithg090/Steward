/**
 * Who may answer from a phone (docs/plans/phone-and-shortcuts.md §3.2). These two ship with Steward
 * and cannot be switched off. Unlike the presets on `/rules`, which judge tool calls, they judge an
 * answer to an approval when it comes from a paired device.
 *
 * A refusal never acts, so a phone may always say no. Only a yes is kept for the Mac.
 */
import type { Approval, ApprovalAnswer, ApprovalDecider, DevicePreset, ToolKind } from "@steward/shared";

export const DEVICE_FLOOR_PRESET: DevicePreset = {
  id: "preset_device_floor",
  name: "From a phone, payments, signing and passwords are finished on your Mac",
  description:
    "A phone can refuse a payment, a signature or a password Steward wants to type, but saying yes to one needs Steward on your Mac.",
  phoneMessage: "Open Steward on your Mac to finish this.",
};

export const DEVICE_TAINT_PRESET: DevicePreset = {
  id: "preset_shortcut_taint",
  name: "From a shortcut, a send or delete after reading untrusted content is finished in the app",
  description:
    "When Steward has read web pages or mail before asking to send, delete or run a command, a shortcut can only refuse. The Steward phone app can say yes after Face ID; otherwise finish it on your Mac.",
  phoneMessage:
    "Steward read something it doesn't trust before asking this. Say yes in the Steward app or on your Mac.",
};

export const DEVICE_PRESETS: readonly DevicePreset[] = [DEVICE_FLOOR_PRESET, DEVICE_TAINT_PRESET];

/** Kinds that untrusted content could have steered. */
const TAINT_SENSITIVE = new Set<ToolKind>(["send", "delete", "shell"]);

/** Facts the presets read: what the approval does, and whether the conversation was tainted. */
export type DecidedFacts = Pick<Approval, "tool" | "tainted" | "credentialEntry">;

/** The preset that refuses this answer from this device, or undefined when the device may give it. */
export function deviceRefusal(
  approval: DecidedFacts,
  answer: ApprovalAnswer,
  by: Pick<ApprovalDecider, "device" | "verified">,
): DevicePreset | undefined {
  if (answer === "refuse") return undefined;
  const kind = approval.tool.kind;
  if (kind === "pay" || kind === "sign" || approval.credentialEntry === true) return DEVICE_FLOOR_PRESET;
  if (approval.tainted === true && TAINT_SENSITIVE.has(kind)) {
    // The phone app may say yes once Face ID checked the person; a shortcut never can.
    if (by.device.kind === "shortcut" || by.verified !== "webauthn") return DEVICE_TAINT_PRESET;
  }
  return undefined;
}
