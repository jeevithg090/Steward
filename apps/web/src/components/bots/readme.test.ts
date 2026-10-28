import { describe, expect, it } from "vitest";
import { readmeBody } from "./BotListingView.tsx";

describe("readmeBody", () => {
  it("drops an opening heading that only repeats the bot's name", () => {
    expect(readmeBody("# Rent Scout\n\nFinds rentals.\n\n## What it needs\n\nNothing.", "Rent Scout")).toBe(
      "Finds rentals.\n\n## What it needs\n\nNothing.",
    );
    expect(readmeBody("## rent scout ##\nFinds rentals.", "Rent Scout")).toBe("Finds rentals.");
  });

  it("keeps an opening heading that says something else, and everything when there is no heading", () => {
    expect(readmeBody("# How it works\n\nSteps.", "Rent Scout")).toBe("# How it works\n\nSteps.");
    expect(readmeBody("Finds rentals.", "Rent Scout")).toBe("Finds rentals.");
    expect(readmeBody(undefined, "Rent Scout")).toBe("");
    expect(readmeBody("# Rent Scout", "Rent Scout")).toBe("");
  });
});
