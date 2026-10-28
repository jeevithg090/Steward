/**
 * The rules Steward ships with. They are stored with source `preset`, start switched on, and can be
 * switched off on `/rules` but not edited or deleted. Ids are stable so a person's on/off choice
 * survives upgrades; a preset that is no longer shipped is removed on start.
 *
 * Regexes in CEL strings are written with single backslashes; see `cel.ts` on escapes.
 */
import type { Effect } from "@steward/shared";

export interface PresetRule {
  id: string;
  name: string;
  effect: Effect;
  when: string;
  description: string;
}

/** Hosts that hand out cloud credentials to whatever can reach them. */
export const METADATA_HOSTS = [
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.goog",
  "fd00:ec2::254",
  "[fd00:ec2::254]",
] as const;

const DESTRUCTIVE_SHELL = [
  // rm with a recursive flag aimed at /, ~ or $HOME (relative paths inside the workspace are fine)
  String.raw`\brm\s+(-[a-z-]+\s+)*(-[a-z]*r[a-z]*|--recursive)\s+(-[a-z-]+\s+)*['"]?(/|~|\$HOME)`,
  String.raw`\brm\s+.*--no-preserve-root`,
  String.raw`\bmkfs(\.[a-z0-9]+)?\b`,
  String.raw`\bdd\s+(\S+\s+)*if=`,
  String.raw`:\(\)\s*\{`,
  String.raw`\b(shutdown|reboot|halt|poweroff)\b`,
  String.raw`\b(sudo|doas)\b`,
  String.raw`>\s*/dev/(sd|nvme|disk|hd)`,
].join("|");

export const PRESET_RULES: readonly PresetRule[] = [
  {
    id: "preset_cloud_metadata",
    name: "Never touch cloud metadata",
    effect: "deny",
    when: `target.host in [${METADATA_HOSTS.map((h) => `"${h}"`).join(", ")}]`,
    description:
      "Cloud metadata addresses hand out the machine's credentials. Nothing Steward does needs them.",
  },
  {
    id: "preset_destructive_shell",
    name: "Never run destructive shell commands",
    effect: "deny",
    when: `tool.kind == "shell" && matches(target.command, "${DESTRUCTIVE_SHELL.replace(/"/g, '\\"')}")`,
    description:
      "Wiping the disk, formatting drives, sudo, shutdown and fork bombs are refused outright, even if you would allow them.",
  },
  {
    id: "preset_pipe_to_shell",
    name: "Never pipe a download into a shell",
    effect: "deny",
    when: String.raw`tool.kind == "shell" && matches(target.command, "\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b")`,
    description:
      "Running a script straight from the internet skips every check. Download it, read it, then decide.",
  },
  {
    id: "preset_secret_files",
    name: "Never touch key and password files",
    effect: "deny",
    when: String.raw`tool.surface == "file" && matches(target.path, "(^|/)(\.env(?!\.(example|sample|template)$)(\.[a-z0-9_-]+)?|id_(rsa|ecdsa|ed25519)|[^/]*\.pem|credentials(\.json)?)$|(^|/)\.(ssh|aws|gnupg)(/|$)")`,
    description:
      "Files such as .env, SSH keys and cloud credentials stay out of reach of the agent's file tools.",
  },
  {
    id: "preset_routine_sends",
    name: "Routines ask before they send",
    effect: "ask",
    when: `initiator.kind == "routine" && tool.kind in ["send", "sign", "delete"]`,
    description:
      "A routine runs while you are away. Anything it would send, sign or delete waits for you, even if you said Always allow.",
  },
  {
    id: "preset_routine_shell",
    name: "Routines ask before running commands",
    effect: "ask",
    when: `initiator.kind == "routine" && tool.kind == "shell"`,
    description: "Commands a routine wants to run wait for you, even ones you allowed before.",
  },
  {
    id: "preset_device_sends",
    name: "Phones ask before they send",
    effect: "ask",
    when: `initiator.kind == "device" && tool.kind in ["send", "sign", "delete", "shell"]`,
    description:
      "Work you start from a phone waits for your answer before it sends, signs, deletes or runs a command, even if you said Always allow. A lost phone should not be able to act for you unasked.",
  },
  {
    id: "preset_reads",
    name: "Reads run freely",
    effect: "allow",
    when: `tool.kind == "read"`,
    description:
      "Reading pages, mail, files and the calendar never changes anything, so it does not ask. What it reads is treated as untrusted.",
  },
];
