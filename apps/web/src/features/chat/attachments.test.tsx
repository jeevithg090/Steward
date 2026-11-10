import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { attachedSentence, attachProblem, readText } from "./attachments.tsx";
import { Composer } from "./Composer.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(upload?: (body: { name: string; text: string }) => { status?: number; body: unknown }) {
  return mockFetch((req) => {
    if (req.path === "/api/skills") return { body: [] };
    if (req.method === "POST" && req.path === "/api/computer/steward/uploads") {
      const body = req.body as { name: string; text: string };
      return (
        upload?.(body) ?? {
          status: 201,
          body: { path: `uploads/${body.name}`, size: new TextEncoder().encode(body.text).length },
        }
      );
    }
    return undefined;
  });
}

function renderComposer(onSend = vi.fn()) {
  const view = renderWithProviders(
    <Composer onSend={onSend} onStop={() => {}} running={false} attachTo="steward" />,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  const pick = (...files: File[]) => fireEvent.change(input, { target: { files } });
  return { ...view, onSend, pick };
}

describe("attaching files", () => {
  it("knows which files it can take", () => {
    expect(attachProblem({ name: "notes.md", size: 10 })).toBeUndefined();
    expect(attachProblem({ name: "photo.jpg", size: 10 })).toMatch(/isn't a kind of file/);
    expect(attachProblem({ name: "README", size: 10 })).toMatch(/isn't a kind of file/);
    expect(attachProblem({ name: "big.csv", size: 3 * 1024 * 1024 })).toMatch(/larger than 2 MB/);
    expect(attachedSentence([{ path: "uploads/a.md", size: 2150 }])).toBe(
      "I attached uploads/a.md (2.1 KB) to your workspace.",
    );
    expect(
      attachedSentence([
        { path: "uploads/a.md", size: 10 },
        { path: "uploads/b.csv", size: 20 },
        { path: "uploads/c.txt", size: 30 },
      ]),
    ).toBe(
      "I attached uploads/a.md (10 B), uploads/b.csv (20 B) and uploads/c.txt (30 B) to your workspace.",
    );
  });

  it("reads UTF-8 text and refuses anything else", async () => {
    expect(await readText(new Blob(["Héllo"]))).toBe("Héllo");
    expect(await readText(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toBeUndefined();
    expect(await readText(new Blob(["a\0b"]))).toBeUndefined();
  });

  it("holds a file until the message is sent, then says where it went", async () => {
    const { calls } = serve();
    const { pick, onSend } = renderComposer();
    pick(new File(["# Plan\n"], "plan.md", { type: "text/markdown" }));
    const chips = await screen.findByRole("list", { name: "Files to send" });
    expect(within(chips).getByText("plan.md")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Attached plan.md. It goes with your next message.",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(screen.getByLabelText("Message Steward"), { target: { value: "Tidy this up" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(
      "Tidy this up\n\nI attached uploads/plan.md (7 B) to your workspace.",
    );
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "plan.md", text: "# Plan\n" });
    expect(screen.queryByRole("list", { name: "Files to send" })).toBeNull();
  });

  it("sends a file on its own, and Remove takes one off before sending", async () => {
    serve();
    const { pick, onSend } = renderComposer();
    pick(new File(["a"], "a.txt"), new File(["b,c"], "b.csv"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove a.txt" }));
    expect(screen.getByRole("status").textContent).toContain("Removed a.txt.");
    expect(screen.queryByText("a.txt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("I attached uploads/b.csv (3 B) to your workspace."),
    );
  });

  it("says why a picture or a binary file was refused, and attaches nothing", async () => {
    const { calls } = serve();
    const { pick } = renderComposer();
    pick(new File([new Uint8Array([0xff, 0xfe, 0x00])], "notes.txt"), new File(["x"], "photo.png"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("“notes.txt” isn't plain text");
    expect(alert.textContent).toContain("“photo.png” isn't a kind of file Steward can read");
    expect(screen.queryByRole("list", { name: "Files to send" })).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("keeps the message and the file when Steward refuses it, and never adds one twice", async () => {
    let refuse = true;
    const { calls } = serve((body) =>
      refuse && body.name === "two.txt"
        ? { status: 413, body: { error: "That file is larger than 2 MB." } }
        : { status: 201, body: { path: `uploads/${body.name}`, size: 1 } },
    );
    const { pick, onSend } = renderComposer();
    pick(new File(["1"], "one.txt"), new File(["2"], "two.txt"));
    fireEvent.change(screen.getByLabelText("Message Steward"), { target: { value: "Read them" } });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That file is larger than 2 MB.");
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Message Steward") as HTMLTextAreaElement).value).toBe("Read them");
    expect(screen.getByText("two.txt")).toBeTruthy();

    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        "Read them\n\nI attached uploads/one.txt (1 B) and uploads/two.txt (1 B) to your workspace.",
      ),
    );
    const posted = calls.filter((c) => c.method === "POST").map((c) => (c.body as { name: string }).name);
    expect(posted).toEqual(["one.txt", "two.txt", "two.txt"]);
  });

  it("offers nothing to attach without a workspace to put it in", () => {
    serve();
    const view = renderWithProviders(<Composer onSend={() => {}} onStop={() => {}} running={false} />);
    expect(screen.queryByRole("button", { name: "Attach a text file" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
  });
});
