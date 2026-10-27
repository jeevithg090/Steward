import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { ChoiceGroup, Field, Input, Switch } from "./Field.tsx";
import { Pill } from "./Pill.tsx";
import { Tabs } from "./Tabs.tsx";

afterEach(cleanup);

/** Small stateful wrappers, so each control is tested the way a page uses it. */
function SwitchHarness() {
  const [on, setOn] = useState(false);
  return (
    <Switch
      checked={on}
      onCheckedChange={setOn}
      label="Read replies aloud"
      description="Uses this device's voices."
    />
  );
}

function TabsHarness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs
      label="Views"
      value={value}
      onValueChange={setValue}
      items={[
        { value: "a", label: "First", count: 2 },
        { value: "b", label: "Second" },
        { value: "c", label: "Third" },
      ]}
    >
      <p>Panel {value}</p>
    </Tabs>
  );
}

function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClose?.();
        }}
        title="Delete this rule?"
        description="It stops applying straight away."
      >
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

describe("Button", () => {
  it("is a real button that says when it is busy", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Pill", () => {
  it("carries a word, not just a colour", () => {
    render(<Pill tone="problem">Couldn't finish</Pill>);
    expect(screen.getByText("Couldn't finish")).toBeTruthy();
  });
});

describe("Field", () => {
  it("labels its control and wires the description and error", () => {
    render(
      <Field label="Name" description="What people call it." error="Give it a name." required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.hasAttribute("required")).toBe(true);
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["What people call it.", "Give it a name."]);
  });
});

describe("Switch", () => {
  it("is a named switch that flips", () => {
    render(<SwitchHarness />);
    const control = screen.getByRole("switch", { name: "Read replies aloud" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("true");
  });
});

describe("ChoiceGroup", () => {
  it("is a named group of native radios", () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        legend="Contrast"
        value="normal"
        onValueChange={onChange}
        choices={[
          { value: "normal", label: "Standard" },
          { value: "more", label: "More contrast" },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Contrast" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Standard" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "More contrast" }));
    expect(onChange).toHaveBeenCalledWith("more");
  });
});

describe("Tabs", () => {
  it("keeps one tab in the Tab order and moves with the arrow keys", () => {
    render(<TabsHarness />);
    const first = screen.getByRole("tab", { name: "First 2" });
    const third = screen.getByRole("tab", { name: "Third" });
    expect(first.tabIndex).toBe(0);
    expect(third.tabIndex).toBe(-1);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(third.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(third);
    expect(screen.getByRole("tabpanel", { name: "Third" }).textContent).toBe("Panel c");
    fireEvent.keyDown(third, { key: "Home" });
    expect(first.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Dialog", () => {
  it("is named by its title, closes on Escape, and gives focus back", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Delete this rule?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Inside");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("Inside")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside", () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    const inside = screen.getByRole("button", { name: "Inside" });
    const close = screen.getByRole("button", { name: "Close" });
    inside.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inside);
  });
});
