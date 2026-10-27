import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Choices } from "./Choices.tsx";
import { isConsentChoice, readChoices } from "./choices.ts";

afterEach(cleanup);

describe("readChoices", () => {
  it("reads strings and { label, message } and drops repeats", () => {
    expect(
      readChoices({
        question: "Which day?",
        choices: ["Friday", { label: "Monday", message: "Monday morning works" }, "friday"],
      }),
    ).toEqual({
      question: "Which day?",
      choices: [
        { label: "Friday", message: "Friday" },
        { label: "Monday", message: "Monday morning works" },
      ],
    });
  });

  it("never offers a chip that reads as consent to send, pay, sign or delete", () => {
    for (const label of [
      "Send it",
      "Yes, send it",
      "Pay now",
      "OK, pay the invoice",
      "Delete them",
      "Approve",
      "Place order",
      "Sign the contract",
    ]) {
      expect(isConsentChoice(label), label).toBe(true);
    }
    for (const label of ["Friday", "Tell me more", "Summarise it", "No thanks", "Show me the draft"]) {
      expect(isConsentChoice(label), label).toBe(false);
    }
    expect(readChoices({ options: ["Send it", "Change the subject"] }).choices.map((c) => c.label)).toEqual([
      "Change the subject",
    ]);
  });
});

describe("Choices", () => {
  it("sends the chosen words as the person's message, once", () => {
    const onChoose = vi.fn();
    render(
      <Choices
        args={{ question: "Which day suits you?", choices: ["Friday", "Monday"] }}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByRole("region", { name: "Which day suits you?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    expect(onChoose).toHaveBeenCalledWith("Monday");

    // Chosen, so every chip is now inactive and the choice is marked.
    expect(screen.getByRole("button", { name: "Monday" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("sends a choice's own message when it has one", () => {
    const onChoose = vi.fn();
    render(
      <Choices
        args={{ choices: [{ label: "Mornings", message: "I prefer mornings" }] }}
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mornings" }));
    expect(onChoose).toHaveBeenCalledWith("I prefer mornings");
  });

  it("stays inactive once the conversation has moved on", () => {
    const onChoose = vi.fn();
    render(<Choices args={{ choices: ["Yes", "No"] }} onChoose={onChoose} disabled />);
    const yes = screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    fireEvent.click(yes);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("draws nothing when every chip was dropped", () => {
    const { container } = render(<Choices args={{ choices: ["Send it"] }} onChoose={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
