import type { WorkspaceFile, WorkspaceFileText } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageCard } from "@/gallery/SmallCards.tsx";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { FilesList } from "./FilesList.tsx";
import { FileViewer, sandboxedDocument, VIEWER_CSP } from "./FileViewer.tsx";

const now = new Date().toISOString();

const PAGE = [
  "<!doctype html><html><head><title>Plan</title>",
  '<link rel="prefetch" href="https://evil.example/s.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
  "</head><body><h1>Prep notes</h1>",
  '<img src="https://evil.example/pixel.png" onerror="fetch(\'/api/rules\')">',
  '<a href="https://evil.example/?q=secret" target="_blank" ping="https://evil.example/p">Read more</a>',
  '<form action="https://evil.example/steal"><button formaction="https://evil.example/b">Go</button></form>',
  '<svg><a xlink:href="javascript:alert(1)"><text>svg link</text></a></svg>',
  "<script>alert(1)</script>",
  "</body></html>",
].join("");

function fileText(path: string, text: string, format: WorkspaceFileText["format"]): WorkspaceFileText {
  return { path, size: text.length, modifiedAt: now, format, text, truncated: false };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sandboxedDocument", () => {
  it("puts a policy that loads nothing first in the head, and takes out what would act or leave", () => {
    const html = sandboxedDocument(PAGE);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const first = doc.head.firstElementChild;
    expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first?.getAttribute("content")).toBe(VIEWER_CSP);
    expect(VIEWER_CSP).toContain("default-src 'none'");
    expect(doc.querySelectorAll("script, link, meta[http-equiv='refresh']")).toHaveLength(0);
    expect(html).not.toMatch(/href=|xlink:href|action=|formaction=|ping=|target=/i);
    // The words stay, and the address is still there to read.
    const link = [...doc.querySelectorAll("a")].find((a) => a.textContent === "Read more");
    expect(link?.getAttribute("title")).toBe("https://evil.example/?q=secret");
    expect(doc.querySelector("h1")?.textContent).toBe("Prep notes");
  });

  it("takes out SVG animations that would put a link back once the page is drawn", () => {
    // A sandboxed frame may still navigate itself, so a link set by an animation could carry
    // what the page says to another site when it is clicked.
    const html = sandboxedDocument(
      [
        "<p>Report</p><svg>",
        '<a><animate attributeName="href" values="https://evil.example/?q=secret" /><text>Open</text></a>',
        '<a><set attributeName="xlink:href" to="https://evil.example/2" /><text>More</text></a>',
        '<a><SET ATTRIBUTENAME=" HREF " to="https://evil.example/3" /><text>Shout</text></a>',
        '<rect><animate attributeName="width" from="0" to="10" dur="1s" /></rect>',
        "</svg>",
      ].join(""),
    );
    expect(html).not.toContain("evil.example");
    const doc = new DOMParser().parseFromString(html, "text/html");
    // An animation that changes nothing that leaves stays, and so do the words.
    expect([...doc.querySelectorAll("*")].filter((n) => n.localName === "animate")).toHaveLength(1);
    expect(doc.body.textContent).toContain("Open");
  });

  it("cleans inside templates, which the frame draws as part of the page (shadowrootmode)", () => {
    const html = sandboxedDocument(
      [
        '<div><template shadowrootmode="open">',
        '<a href="https://evil.example/?q=secret">Read more</a>',
        '<meta http-equiv="refresh" content="0;url=https://evil.example/r">',
        '<svg><a><set attributeName="href" to="https://evil.example/s" /><text>More</text></a></svg>',
        "<template><a href='https://evil.example/deeper'>Deeper</a></template>",
        "</template></div>",
      ].join(""),
    );
    expect(html).not.toMatch(/href=|http-equiv="refresh"|<set/i);
    expect(html.match(/evil\.example/g) ?? []).toHaveLength(2); // the two links' titles only
    expect(html).toContain("Read more");
  });

  it("reads the page again the way the frame will, until nothing changes", () => {
    // In the first reading the link is the text of a style; read again, it is a real link.
    const tricky =
      '<form><math><mtext></form><form><mglyph><style></math><a href="https://evil.example/m">mx</a>';
    for (const page of [PAGE, tricky, "<p>Plain</p>", "<table><td>cell</table><p>after"]) {
      const once = sandboxedDocument(page);
      expect(sandboxedDocument(once)).toBe(once);
      expect(once).not.toMatch(/href=/i);
    }
  });

  it("shows nothing of a page that never settles", () => {
    let readings = 0;
    const Real = DOMParser;
    vi.stubGlobal(
      "DOMParser",
      class extends Real {
        override parseFromString(text: string, type: DOMParserSupportedType): Document {
          const doc = super.parseFromString(text, type);
          readings += 1;
          doc.body.append(doc.createTextNode(` reading ${readings}`));
          return doc;
        }
      },
    );
    const html = sandboxedDocument("<h1>Shifting</h1>");
    expect(html).toContain("can't be shown safely here");
    expect(html).not.toContain("Shifting");
    expect(html).toContain(VIEWER_CSP);
  });
});

describe("FileViewer", () => {
  it("draws a page in a frame with every sandbox permission off", async () => {
    mockFetch((req) =>
      req.path === "/api/computer/steward/file" && req.query.get("path") === "made/plan.html"
        ? { body: fileText("made/plan.html", PAGE, "html") }
        : undefined,
    );
    renderWithProviders(<FileViewer agentId="steward" path="made/plan.html" />);
    const frame = (await screen.findByTitle(
      /plan\.html, with its scripts and links turned off/,
    )) as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain(VIEWER_CSP);
    expect(frame.getAttribute("srcdoc")).not.toContain("<script");
    expect(frame.getAttribute("src")).toBeNull();
  });

  it("shows Markdown with its images not loaded, and other files as plain text", async () => {
    mockFetch((req) => {
      const path = req.query.get("path");
      if (path === "made/notes.md")
        return {
          body: fileText(path, "# Notes\n\n![tracker](https://evil.example/t.png)\n\nHello", "markdown"),
        };
      if (path === "data.csv") return { body: fileText(path, "a,b\n<b>1</b>,2", "csv") };
      return undefined;
    });
    const md = renderWithProviders(<FileViewer agentId="steward" path="made/notes.md" />);
    expect(await screen.findByText("Hello")).toBeTruthy();
    expect(md.container.querySelector("img")).toBeNull();
    expect(screen.getByText(/Image not loaded: tracker/)).toBeTruthy();
    md.unmount();

    const csv = renderWithProviders(<FileViewer agentId="steward" path="data.csv" />);
    expect(await screen.findByText(/<b>1<\/b>,2/)).toBeTruthy();
    expect(csv.container.querySelector("b")).toBeNull();
  });

  it("says why a file could not be opened", async () => {
    mockFetch(() => ({
      status: 415,
      body: { error: "This file isn't plain text, so it can't be shown here." },
    }));
    renderWithProviders(<FileViewer agentId="steward" path="photo.dat" />);
    expect(await screen.findByText(/isn't plain text/)).toBeTruthy();
  });
});

describe("opening a file", () => {
  it("opens a file from the Files list, and the highlighted one is marked", async () => {
    const files: WorkspaceFile[] = [
      { path: "made", size: 0, modifiedAt: now, isDirectory: true },
      { path: "made/plan.md", size: 20, modifiedAt: now, isDirectory: false },
    ];
    const { calls } = mockFetch((req) => {
      if (req.path === "/api/computer/steward/files") return { body: files.filter((f) => !f.isDirectory) };
      if (req.path === "/api/computer/steward/file")
        return { body: fileText("made/plan.md", "# Plan\n\nStep one", "markdown") };
      return undefined;
    });
    renderWithProviders(<FilesList agentId="steward" highlight="made/plan.md" />);
    const row = await screen.findByRole("button", { name: /Open plan\.md/ });
    expect(row.closest("li")?.getAttribute("aria-current")).toBe("true");
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: "plan.md" });
    expect(await within(dialog).findByText("Step one")).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/computer/steward/file?path=made%2Fplan.md")).toBe(true);
  });

  it("opens a page from its card in the chat, from the conversation's agent's workspace", async () => {
    const { calls } = mockFetch((req) =>
      req.path === "/api/computer/helper/file"
        ? { body: fileText("made/plan.md", "Ready", "markdown") }
        : undefined,
    );
    renderWithProviders(
      <PageCard agentId="helper" page={{ title: "Plan", path: "made/plan.md", format: "markdown" }} />,
    );
    expect(screen.getByRole("link", { name: "Show in Steward's files" }).getAttribute("href")).toBe(
      "/computer?agent=helper&file=made%2Fplan.md",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Plan" }));
    const dialog = await screen.findByRole("dialog", { name: "plan.md" });
    await waitFor(() => expect(within(dialog).getByText("Ready")).toBeTruthy());
    expect(calls[0]?.path).toBe("/api/computer/helper/file");
  });
});
