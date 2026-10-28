import type { BotPack } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { firstSentence, slugify, truncateAtWord } from "../text.ts";

/**
 * CopilotKit OpenBot's coworkers (github.com/CopilotKit/openbot, `examples/fintech/catalog/`, MIT):
 * ten YAML files, each a standing role with a `role_description` that says what the job is, what
 * the coworker must not do and what to say when it cannot find something. They become "work"
 * packs, credited to OpenBot.
 */

export const OPENBOT_REPO = "https://github.com/CopilotKit/openbot";
export const OPENBOT_HANDLE = "CopilotKit OpenBot";

const CoworkerSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  title: z.string().max(120).optional(),
  role_description: z.string().min(80),
  system_prompt: z.string().optional(),
  skills: z.array(z.string()).default([]),
});

/** OpenBot skills name capabilities; these are the Steward tools that do the same work. */
export const OPENBOT_SKILL_TOOLS: Record<string, string[]> = {
  "find-a-document": ["file_list", "file_read"],
  "whats-changed": ["file_list", "file_read"],
  "who-owns-this": ["file_read"],
  "check-a-claim": ["file_read"],
  "research-public-web": ["web_search", "web_fetch"],
  "find-a-notion-page": [],
};

/** Starters for the ten coworkers that ship; any other file gets a generic pair. */
export const OPENBOT_STARTERS: Record<string, string[]> = {
  "expense-review": [
    "Here is a claim and the policy. Check it line by line.",
    "What is missing from this claim before anyone can decide?",
  ],
  "feedback-digest": [
    "Here are last month's messages from customers. What are the themes?",
    "How many accounts asked about this, and what did they say?",
  ],
  "interview-notes": [
    "Write up the interview I am about to describe.",
    "Here are my notes from the call. Keep what was asked and answered apart.",
  ],
  "meeting-follow-ups": [
    "Here are the notes. What did people say they would do?",
    "What was discussed and left undecided?",
  ],
  "onboarding-buddy": [
    "I started on Monday. How do I book leave?",
    "What does the handbook say about working from home?",
  ],
  "oncall-handover": [
    "Write the handover for the shift that just ended.",
    "What is still open, and who wrote the last update?",
  ],
  "release-notes": [
    "Here is the list of changes. Write the notes.",
    "Which of these changes would someone outside the team notice?",
  ],
  "research-desk": ["Read around this question and write me a brief.", "What could you not find?"],
  "ticket-triage": [
    "Here is a ticket. What is it asking, how urgent is it, and who should have it?",
    "Is there a runbook or an earlier ticket that covers this?",
  ],
  "vendor-review": [
    "We renew with this vendor next quarter. Assemble what is known.",
    "When is the notice period, and which clause sets it?",
  ],
};

/** The pitch is the comment on the first line of each file; `# Reads one claim …`. */
function leadingComment(yamlText: string): string | undefined {
  const lines: string[] = [];
  for (const line of yamlText.split("\n")) {
    if (!line.startsWith("#")) break;
    lines.push(line.replace(/^#\s?/, "").trim());
  }
  const text = lines.join(" ").trim();
  return text || undefined;
}

export function convertOpenBotCoworker(yamlText: string): BotPack {
  const raw = parseYaml(yamlText) as unknown;
  const checked = CoworkerSchema.safeParse(raw);
  if (!checked.success) {
    const first = checked.error.issues[0];
    throw new Error(`OpenBot coworker: ${first?.path.join(".") ?? ""} ${first?.message ?? "is wrong"}`);
  }
  const coworker = checked.data;
  const role = coworker.role_description.replace(/\s+/g, " ").trim();
  const prompt = coworker.system_prompt?.replace(/\s+/g, " ").trim();
  const pitch = truncateAtWord(leadingComment(yamlText) ?? firstSentence(role), 240);
  const tools = [...new Set(coworker.skills.flatMap((s) => OPENBOT_SKILL_TOOLS[s] ?? []))];
  if (!tools.includes("make_page")) tools.push("make_page");
  const unmapped = coworker.skills.filter((s) => (OPENBOT_SKILL_TOOLS[s] ?? []).length === 0);
  const starters = OPENBOT_STARTERS[coworker.id] ?? [
    `Here is what I have. ${pitch}`,
    "What could you not find?",
  ];
  const instructions = `${role}${prompt ? `\n\n## How to answer\n\n${prompt}` : ""}

## In Steward

Write what you produce with make_page and say in one sentence where it is. You draft; a person sends, files or publishes. If a tool is not connected or answers with an error, say so and stop.`;
  const name = truncateAtWord(coworker.name, 80);
  const readme = `# ${name}

${pitch}

${coworker.title ? `A coworker for ${coworker.title.toLowerCase()}. ` : ""}It works from the documents and pages it is given, says what it could not find, and decides nothing on its own.

## What it needs

- Tools: ${tools.join(", ")}
${unmapped.length > 0 ? `- OpenBot's "${unmapped.join('", "')}" skill needs a connected source (an MCP server) that this pack does not bring.\n` : ""}
## What it will not do

It never sends, approves, closes or publishes anything. A rule in the pack makes the gateway refuse sending outright.

## Credit

Adapted from CopilotKit OpenBot's coworker catalogue (MIT): ${OPENBOT_REPO}.`;
  return {
    id: slugify(`openbot-${coworker.id}`),
    name,
    pitch,
    category: "work",
    version: 1,
    author: { kind: "person", handle: OPENBOT_HANDLE, url: OPENBOT_REPO },
    licence: "MIT",
    needs: { tools, connectors: [], model: "any" },
    instructions,
    starters,
    examples: [{ ask: starters[0] as string, does: pitch }],
    skills: [],
    rules: [
      {
        name: "Drafts only",
        effect: "deny",
        when: 'tool.kind == "send"',
        description: "This coworker drafts; a person sends.",
      },
    ],
    routines: [],
    shortcuts: [],
    readme,
  };
}
