import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { GalleryPreviews, PREVIEWS } from "./previews.tsx";

afterEach(cleanup);

describe("GalleryPreviews", () => {
  it("draws every card from its example data, each labelled as an example", () => {
    render(
      <MemoryRouter>
        <GalleryPreviews />
      </MemoryRouter>,
    );
    for (const preview of PREVIEWS) {
      expect(screen.getByRole("region", { name: `${preview.title} (example)` })).toBeTruthy();
    }
    expect(screen.getAllByText(/Example data/)).toHaveLength(PREVIEWS.length);
    // Each chart drew a picture rather than its fallback.
    expect(screen.getAllByRole("img").length).toBe(3);
  });
});
