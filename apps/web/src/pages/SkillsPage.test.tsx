import type { Skill } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { SkillsPage } from "./SkillsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SKILLS: Skill[] = [
  {
    id: "skl_1",
    name: "weekly-review",
    description: "A short summary of the week.",
    instructions: "Look at what I did this week.",
    tools: [],
    source: "person",
  },
  {
    id: "skl_2",
    name: "scam-check",
    description: "Checks a message that looks off.",
    instructions: "Read it and say whether it looks like a scam.",
    tools: [],
    source: "tenant",
  },
];

function serve(skills: Skill[] = SKILLS) {
  return mockFetch((req) => {
    if (req.path === "/api/skills" && req.method === "GET") return { body: skills };
    if (req.path === "/api/skills/skl_1" && req.method === "DELETE") return { status: 204 };
    return undefined;
  });
}

describe("SkillsPage", () => {
  it("lets the person edit and delete their own skills, but not the setup's", async () => {
    serve();
    renderWithProviders(<SkillsPage />);
    const mine = await screen.findByRole("article", { name: "/weekly-review" });
    const setup = screen.getByRole("article", { name: "/scam-check" });
    expect(within(mine).getByRole("button", { name: "Edit /weekly-review" })).toBeTruthy();
    expect(within(setup).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
    expect(within(setup).getByText("From your setup")).toBeTruthy();
  });

  it("deletes a skill only after the person confirms", async () => {
    const server = serve();
    renderWithProviders(<SkillsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete /weekly-review" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete /weekly-review?" });
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(server.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/skills/skl_1");
  });

  it("says when there are no skills", async () => {
    serve([]);
    renderWithProviders(<SkillsPage />);
    expect(await screen.findByText("No skills yet")).toBeTruthy();
  });
});
