import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS_PER_BRIEF, suggestionTitle } from "../src/suggestions.ts";
import { email, fakeMail, fakeModel, setup, subjectModel } from "./helpers.ts";

function urgent(n: number) {
  return Array.from({ length: n }, (_, i) =>
    email({
      subject: `Order ${i + 1} today!`,
      from: { name: `Customer ${i + 1}`, email: `c${i + 1}@shop.example` },
      receivedAt: new Date(Date.parse("2026-10-22T07:00:00Z") - i * 60_000).toISOString(),
    }),
  );
}

describe("suggestions from the brief", () => {
  it("turns up to five needs-you emails into suggested tasks", async () => {
    const p = setup({ mail: () => fakeMail({ emails: urgent(7) }), model: () => subjectModel() });
    const brief = await p.brief.generate();
    expect(brief.needsYou).toHaveLength(7);
    const suggested = p.tasks.list({ state: "suggested" });
    expect(suggested).toHaveLength(MAX_SUGGESTIONS_PER_BRIEF);
    const first = suggested.find((t) => t.title === "Reply to Customer 1 about Order 1 today!");
    expect(first).toMatchObject({
      source: "suggestion",
      state: "suggested",
      emailId: brief.needsYou[0]!.emailId,
      detail: brief.needsYou[0]!.reason,
    });
    expect(first?.nextStep).toContain("Nothing is sent until you allow it.");
    expect(p.bus.of("task.updated")).toHaveLength(MAX_SUGGESTIONS_PER_BRIEF);
  });

  it("does not suggest mail nobody could sort", async () => {
    const failing = fakeModel(() => {
      throw new Error("down");
    });
    const p = setup({ mail: () => fakeMail({ emails: urgent(3) }), model: () => failing });
    await p.brief.generate();
    expect(p.tasks.list({ state: "suggested" })).toEqual([]);
  });

  it("never duplicates an open suggestion when the brief is rebuilt", async () => {
    const p = setup({ mail: () => fakeMail({ emails: urgent(3) }), model: () => subjectModel() });
    await p.brief.generate();
    await p.brief.generate({ force: true });
    expect(p.tasks.list({ state: "suggested" })).toHaveLength(3);
  });

  it("never suggests an email again once it has had a task, hidden or not", async () => {
    const emails = urgent(3);
    const p = setup({ mail: () => fakeMail({ emails }), model: () => subjectModel() });
    await p.brief.generate();
    const [a, b, c] = p.tasks.list({ state: "suggested" }).sort((x, y) => x.title.localeCompare(y.title));
    p.tasks.update(a!.id, { state: "hidden" });
    p.tasks.update(b!.id, { state: "working" });
    p.tasks.update(c!.id, { state: "resolved" });

    const fresh = () => {
      for (const e of emails) e.receivedAt = p.clock.now().toISOString();
    };
    p.clock.advance(3 * 24 * 3600_000);
    fresh();
    await p.brief.generate({ force: true });
    expect(p.tasks.list({ state: "suggested" })).toEqual([]);

    // Twenty days on, the same emails are still not offered again: Hide means hide.
    p.clock.advance(17 * 24 * 3600_000);
    fresh();
    await p.brief.generate({ force: true });
    expect(p.tasks.list({ state: "suggested" })).toEqual([]);
  });

  it("offers next month's email with the same title once the last task is long closed", async () => {
    const invoice = (id: string, at: string) =>
      email({
        id,
        subject: "Re: Invoice!",
        from: { name: "Ana Pereira", email: "ana@hearthandco.example" },
        receivedAt: at,
      });
    const emails = [invoice("inv_sep", "2026-09-12T07:00:00Z")];
    const p = setup({
      at: "2026-09-12T08:00:00Z",
      mail: () => fakeMail({ emails }),
      model: () => subjectModel(),
    });
    await p.brief.generate();
    const [first] = p.tasks.list({ state: "suggested" });
    expect(first?.title).toBe("Reply to Ana Pereira about Invoice!");
    p.tasks.update(first!.id, { state: "resolved" });

    // A follow-up a week later with the same subject is not suggested: the task was closed recently.
    p.clock.set("2026-09-19T08:00:00Z");
    emails.splice(0, emails.length, invoice("inv_sep_2", "2026-09-19T07:00:00Z"));
    await p.brief.generate();
    expect(p.tasks.list({ state: "suggested" })).toEqual([]);

    // Next month's invoice is.
    p.clock.set("2026-10-22T08:00:00Z");
    emails.splice(0, emails.length, invoice("inv_oct", "2026-10-22T07:00:00Z"));
    await p.brief.generate();
    expect(p.tasks.list({ state: "suggested" }).map((t) => t.emailId)).toEqual(["inv_oct"]);
  });

  it("never suggests a title twice while a task with it is open", async () => {
    const emails = urgent(1);
    const p = setup({ mail: () => fakeMail({ emails }), model: () => subjectModel() });
    p.tasks.create({
      title: "Reply to Customer 1 about Order 1 today!",
      detail: "",
      source: "chat",
      state: "working",
    });
    p.clock.advance(60 * 24 * 3600_000);
    emails[0]!.receivedAt = p.clock.now().toISOString();
    const brief = await p.brief.generate();
    expect(brief.needsYou).toHaveLength(1);
    expect(p.tasks.list({ state: "suggested" })).toEqual([]);
  });

  it("words a suggestion for a no-reply sender as looking into it, and drops reply prefixes", () => {
    const item = {
      emailId: "m1",
      subject: "Payment failed: invoice #5521",
      from: { name: "Stripe", email: "no-reply@stripe.example" },
      verdict: "needs_you" as const,
      reason: "A supplier payment failed.",
      confidence: 0.75,
      by: "model" as const,
    };
    expect(suggestionTitle(item)).toBe("Look into “Payment failed: invoice #5521” from Stripe");
    expect(
      suggestionTitle({ ...item, subject: "Re: RE: catalogue shoot", from: { email: "tom@photo.example" } }),
    ).toBe("Reply to tom@photo.example about catalogue shoot");
    expect(suggestionTitle({ ...item, subject: "", from: { name: "Tom", email: "tom@photo.example" } })).toBe(
      "Reply to Tom",
    );
  });
});
