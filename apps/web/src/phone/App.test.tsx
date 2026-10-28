import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PhoneApp } from "./App.tsx";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("the phone app", () => {
  it("asks to be paired from the Mac when it holds no keys", async () => {
    render(<PhoneApp />);
    expect(await screen.findByText("Pair this phone first")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("opens the pairing form from the QR code's address, naming the phone first", async () => {
    history.replaceState(null, "", `/#pair=${"a".repeat(32)}.${"B".repeat(43)}`);
    render(<PhoneApp />);
    expect(await screen.findByRole("heading", { level: 1, name: "Pair with Steward" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /This phone's name/ }) as HTMLInputElement).value).toBe(
      "iPhone",
    );
    expect(screen.getByRole("button", { name: "Pair" })).toBeTruthy();
  });
});
