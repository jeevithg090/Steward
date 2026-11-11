import type { WorkspaceFile } from "@steward/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesList } from "./FilesList.tsx";

const at = new Date().toISOString();
const entry = (path: string, isDirectory = false): WorkspaceFile => ({
  path,
  size: isDirectory ? 0 : 120,
  modifiedAt: at,
  isDirectory,
});

// What a running computer sends: the whole tree, every nested file by its full path.
const tree = [
  entry("downloads", true),
  entry("downloads/report.csv"),
  entry("made", true),
  entry("made/page.html"),
  entry("made/assets", true),
  entry("made/assets/logo.svg"),
  entry("link", true),
  entry("notes.md"),
];

/** What the server sends for each folder. */
const listings: Record<string, WorkspaceFile[]> = {
  "": tree,
  made: tree.filter((file) => file.path.startsWith("made/")),
  // A stopped computer's folder is read from disk, where a linked folder comes back under the name
  // of the folder it points to.
  link: [entry("target/inside.txt")],
};

vi.mock("@/lib/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api.ts")>();
  return {
    ...actual,
    useComputerFiles: (_agentId: string, dir?: string) => ({
      data: listings[dir ?? ""] ?? [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
  };
});

afterEach(cleanup);

/** The name shown on each row: the first text after the icon. */
const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("span")?.textContent);

describe("FilesList", () => {
  it("shows one folder at a time, even when the server sends the whole tree", () => {
    render(<FilesList agentId="steward" />);
    expect(names(screen.getByRole("list", { name: "Files in the workspace" }))).toEqual([
      "downloads",
      "link",
      "made",
      "notes.md",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /made/ }));
    expect(names(screen.getByRole("list", { name: "Files in made" }))).toEqual(["assets", "page.html"]);
  });

  it("shows what is in a linked folder when it is read from disk", () => {
    render(<FilesList agentId="steward" />);
    fireEvent.click(screen.getByRole("button", { name: /link/ }));
    expect(names(screen.getByRole("list", { name: "Files in link" }))).toEqual(["inside.txt"]);
  });
});
