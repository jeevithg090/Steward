import type { Message } from "@copilotkit/react-core/v2";
import { describe, expect, it } from "vitest";
import {
  currentStep,
  latestTurnToolCalls,
  newestAssistantText,
  openToolCall,
  plainRunError,
  textOf,
} from "./messages.ts";
import { matchSkills, slashQuery } from "./skill-match.ts";

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

const conversation: Message[] = [
  { id: "u1", role: "user", content: "Check the news" },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [call("c1", "browser_navigate", { url: "https://news.ycombinator.com" })],
  },
  { id: "t1", role: "tool", toolCallId: "c1", content: "{}" },
  { id: "a2", role: "assistant", content: "The top story is about compilers." },
  { id: "u2", role: "user", content: "And my mail?" },
  { id: "a3", role: "assistant", content: "", toolCalls: [call("c2", "mail_list")] },
];

describe("messages", () => {
  it("reads text from strings and content parts", () => {
    expect(textOf("hello")).toBe("hello");
    expect(textOf([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("ab");
    expect(textOf(undefined)).toBe("");
  });

  it("finds the tool calls of the latest turn only", () => {
    expect([...latestTurnToolCalls(conversation)]).toEqual(["c2"]);
  });

  it("names the step in progress", () => {
    expect(openToolCall(conversation)?.id).toBe("c2");
    expect(currentStep(conversation)).toBe("Reading your mail");
    expect(currentStep(conversation.slice(0, 4))).toBe("Writing");
    expect(currentStep(conversation.slice(0, 1))).toBe("Thinking");
  });

  it("finds the newest reply with words in it", () => {
    expect(newestAssistantText(conversation)).toEqual({
      id: "a2",
      text: "The top story is about compilers.",
    });
  });

  it("turns run failures into sentences", () => {
    expect(plainRunError(new Error("Thread has 1 pending interrupt(s) not addressed by resume"))).toBe(
      "Answer the request above first, then try again.",
    );
    expect(plainRunError(new TypeError("Failed to fetch"))).toContain("Couldn't reach Steward");
    expect(plainRunError("weird")).toBe("Steward couldn't finish that reply.");
  });
});

describe("skill picker matching", () => {
  const skill = (name: string) => ({
    id: name,
    name,
    description: "",
    instructions: "",
    tools: [],
    source: "person" as const,
  });
  const skills = [skill("weekly-review"), skill("morning-brief"), skill("review-pr")];

  it("opens only for a bare slash and a partial name", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Wee")).toBe("wee");
    expect(slashQuery("/weekly-review do it")).toBeUndefined();
    expect(slashQuery("hello /x")).toBeUndefined();
  });

  it("lists names that start with the query first", () => {
    expect(matchSkills(skills, "rev").map((s) => s.name)).toEqual(["review-pr", "weekly-review"]);
    expect(matchSkills(skills, "").length).toBe(3);
  });
});
