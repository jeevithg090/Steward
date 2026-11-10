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

/**
 * Each pattern below is written so that matching takes time in proportion to the command, however
 * it is padded. A pattern that backtracks would let a long command freeze the server while it is
 * checked, so:
 * - nothing scans to the end of the command from every word: a scan that has no bound starts only
 *   where a simple command starts (after `;`, `&`, `|`, a newline or a backtick), and stops where it
 *   ends, so each part of the command is read once;
 * - a scan that starts at a word reads at most a few words (`{0,8}`);
 * - no two parts of a pattern can match the same text two ways (`[a-qs-z]*r`, not `[a-z]*r`).
 * The tests time each preset on long, hostile commands.
 */

/** Where a simple command starts: the beginning, or just after `;`, `&`, `|`, a newline or a backtick. */
const START = String.raw`(?:^|[;&|\n\r\x60])`;
/** Any text up to the end of the simple command, as little as needed. */
const REST = String.raw`[^;&|\n\r\x60]*?`;
/** A command-line flag and the space after it, up to eight of them. */
const FLAGS = String.raw`(?:-[^\s;&|]+\s+){0,8}`;
/** A path in front of a program's name, such as /usr/bin/. */
const DIRS = String.raw`(?:[^\s;&|/]*/)*`;
/** A download command, by name or by path. */
const DOWNLOAD = String.raw`${DIRS}(?:curl|wget|fetch)\b`;
/** A shell, by name or by path: sh, bash, zsh, dash, ksh, fish, /bin/sh. */
const SHELL = String.raw`${DIRS}(?:ba|z|da|k|fi)?sh\b`;

/**
 * Text up to the first `word` in the simple command, read once: `(?=(…))\k<…>` keeps what the
 * look-ahead found, so a failed match never tries a later `word` all over again.
 */
function firstInCommand(group: string, word: string): string {
  return String.raw`${START}(?=(?<${group}>${REST}\b${word}(?=\s)))\k<${group}>`;
}

const DESTRUCTIVE_SHELL = [
  // rm with a recursive flag aimed at /, ~ or $HOME (relative paths inside the workspace are fine).
  // The flag and the path may come in any order after rm, within the same simple command.
  String.raw`${firstInCommand("rm", "rm")}(?=${REST}\s-(?:[a-qs-z]*r[a-z]*|-recursive)(?![^\s;&|]))(?=${REST}\s['"]?(?:/|~|\$\{?HOME\b))`,
  String.raw`--no-preserve-root\b`,
  String.raw`\bmkfs(?:\.[a-z0-9]+)?\b`,
  // dd reading from anything (if=), within the same simple command.
  String.raw`${firstInCommand("dd", "dd")}(?=${REST}\sif=)`,
  String.raw`:\(\)\s*\{`,
  String.raw`\b(?:shutdown|reboot|halt|poweroff)\b`,
  String.raw`\b(?:sudo|doas)\b`,
  String.raw`>\s*/dev/(?:sd|nvme|disk|hd)`,
].join("|");

const PIPE_TO_SHELL = [
  // A download anywhere in the command, and a pipe into a shell anywhere in it (through tee or
  // anything else). Anchored at the start and written as two look-aheads, so it reads the command once.
  String.raw`^(?=[\s\S]*\b(?:curl|wget|fetch)\b)(?=[\s\S]*\|\s*(?:(?:sudo|doas)\s+${FLAGS}|env\s+|exec\s+)?${SHELL})`,
  // A shell or eval running a download's output: bash -c "$(curl …)", eval "$(curl …)", bash <(curl …).
  String.raw`\b(?:(?:ba|z|da|k|fi)?sh|eval|source)\s+${FLAGS}(?:["']?\$\(|<\()\s*${DOWNLOAD}`,
  // Sourcing a download: . <(curl …)
  String.raw`(?:^|[\s;&|(])\.\s+<\(\s*${DOWNLOAD}`,
].join("|");

/** CEL text for a regex: backslashes stay single (see `cel.ts`), double quotes are escaped. */
function celRegex(pattern: string): string {
  return `"${pattern.replace(/"/g, '\\"')}"`;
}

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
    when: `tool.kind == "shell" && matches(target.command, ${celRegex(DESTRUCTIVE_SHELL)})`,
    description:
      "Wiping the disk, formatting drives, sudo, shutdown and fork bombs are refused outright, even if you would allow them.",
  },
  {
    id: "preset_pipe_to_shell",
    name: "Never pipe a download into a shell",
    effect: "deny",
    when: `tool.kind == "shell" && matches(target.command, ${celRegex(PIPE_TO_SHELL)})`,
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
