import { describe, expect, it } from "vitest";
import { decodeJson, listFrom, readToolResult, recordFrom, refusalHeadline } from "./tool-result.ts";

describe("decodeJson", () => {
  it("parses JSON once, and again while the result is still JSON text", () => {
    const value = { title: "Hacker News" };
    expect(decodeJson(JSON.stringify(value))).toEqual(value);
    expect(decodeJson(JSON.stringify(JSON.stringify(value)))).toEqual(value);
  });

  it("leaves plain text alone", () => {
    expect(decodeJson("Opened the page.")).toBe("Opened the page.");
    expect(decodeJson("{not json")).toBe("{not json");
  });
});

describe("readToolResult", () => {
  it("treats a missing result as still running", () => {
    expect(readToolResult(undefined)).toEqual({ status: "pending" });
  });

  it("reads a successful envelope", () => {
    const result = JSON.stringify({ ok: true, data: { url: "https://example.com", title: "Example" } });
    expect(readToolResult(result)).toEqual({
      status: "ok",
      data: { url: "https://example.com", title: "Example" },
    });
  });

  it("reads a double-encoded envelope", () => {
    const result = JSON.stringify(JSON.stringify({ ok: true, data: [1, 2, 3] }));
    expect(readToolResult(result)).toEqual({ status: "ok", data: [1, 2, 3] });
  });

  it("unwraps untrusted content inside an envelope, keeping its notice", () => {
    const result = JSON.stringify({
      ok: true,
      data: { untrusted: true, notice: "Text from news.ycombinator.com", data: { title: "Top story" } },
    });
    expect(readToolResult(result)).toEqual({
      status: "ok",
      data: { title: "Top story" },
      untrusted: { notice: "Text from news.ycombinator.com" },
    });
  });

  it("unwraps an envelope inside the untrusted wrapper, with encoded data at each layer", () => {
    const inner = JSON.stringify({ ok: true, data: JSON.stringify([{ id: "e1" }]) });
    const result = JSON.stringify({ untrusted: "mail", data: inner });
    const outcome = readToolResult(result);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.data).toEqual([{ id: "e1" }]);
      expect(outcome.untrusted).toEqual({ notice: undefined });
    }
  });

  it("reads a refusal with the rule that decided it", () => {
    const result = JSON.stringify({
      ok: false,
      refused: true,
      rule: "No payments",
      message: "Payments are off.",
    });
    const outcome = readToolResult(result);
    expect(outcome).toEqual({ status: "refused", rule: "No payments", message: "Payments are off." });
    if (outcome.status === "refused")
      expect(refusalHeadline(outcome)).toBe("Refused by your rule ‘No payments’");
  });

  it("reads a refusal written with `reason`, and says Refused without a rule", () => {
    const outcome = readToolResult(
      JSON.stringify({ ok: false, refused: true, reason: "The person refused." }),
    );
    expect(outcome).toEqual({ status: "refused", message: "The person refused." });
    if (outcome.status === "refused") expect(refusalHeadline(outcome)).toBe("Refused");
  });

  it("reads a parked call", () => {
    const result = JSON.stringify({
      ok: false,
      parked: true,
      approvalId: "apr_1",
      message: "Waiting for you.",
    });
    expect(readToolResult(result)).toEqual({
      status: "parked",
      approvalId: "apr_1",
      message: "Waiting for you.",
    });
  });

  it("reads an error", () => {
    expect(readToolResult(JSON.stringify({ ok: false, error: "The page did not load." }))).toEqual({
      status: "error",
      message: "The page did not load.",
    });
  });

  it("treats anything that is not an envelope as data", () => {
    expect(readToolResult('[{"title":"A"}]')).toEqual({ status: "ok", data: [{ title: "A" }] });
    expect(readToolResult("Saved.")).toEqual({ status: "ok", data: "Saved." });
    expect(readToolResult("")).toEqual({ status: "ok", data: "" });
  });
});

describe("listFrom and recordFrom", () => {
  it("finds a list under a known key, or the value itself", () => {
    expect(listFrom([1], ["items"])).toEqual([1]);
    expect(listFrom({ emails: [{ id: "a" }] }, ["emails"])).toEqual([{ id: "a" }]);
    expect(listFrom({ emails: JSON.stringify([{ id: "b" }]) }, ["emails"])).toEqual([{ id: "b" }]);
    expect(listFrom({ other: [] }, ["emails"])).toBeUndefined();
  });

  it("finds an object under a known key, or the value itself", () => {
    expect(recordFrom({ task: { id: "t1" } }, ["task"])).toEqual({ id: "t1" });
    expect(recordFrom({ id: "t2" }, ["task"])).toEqual({ id: "t2" });
    expect(recordFrom("[1]")).toBeUndefined();
  });
});
