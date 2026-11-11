import { describe, expect, it } from "vitest";
import { MIN_SCRUBBED_INSIDE, SecretEcho } from "../src/secrets.ts";

const HIDE = "[hidden]";

describe("SecretEcho", () => {
  it("hides a filled value wherever it appears, and nothing else", () => {
    const echo = new SecretEcho();
    expect(echo.scrub("correct-horse", HIDE)).toBe("correct-horse");
    echo.add("correct-horse");
    expect(echo.size).toBe(1);
    expect(echo.has("correct-horse")).toBe(true);
    expect(echo.has("correct-hors")).toBe(false);
    expect(echo.scrub("correct-horse", HIDE)).toBe(HIDE);
    expect(echo.scrub("Strength of correct-horse: weak", HIDE)).toBe(`Strength of ${HIDE}: weak`);
    expect(echo.scrub("correct-horsecorrect-horse!", HIDE)).toBe(`${HIDE}${HIDE}!`);
    expect(echo.scrub("correct-horsE and correct horse", HIDE)).toBe("correct-horsE and correct horse");
  });

  it("hides several values of different lengths, and overlapping ones once", () => {
    const echo = new SecretEcho();
    echo.add("abcdef");
    echo.add("defghi");
    echo.add("pass phrase with spaces");
    expect(echo.scrub("xxabcdefghiyy", HIDE)).toBe(`xx${HIDE}yy`);
    expect(echo.scrub("say pass phrase with spaces twice", HIDE)).toBe(`say ${HIDE} twice`);
    expect(echo.scrub("emoji 😀 abcdef", HIDE)).toBe(`emoji 😀 ${HIDE}`);
  });

  it("hides a value written into an address, encoded either common way", () => {
    const echo = new SecretEcho();
    echo.add("p@ss word!");
    // A GET form sends p%40ss+word%21; encodeURIComponent writes p%40ss%20word!.
    expect(echo.scrub("/done?code=p%40ss+word%21&page=2", HIDE)).toBe(`/done?code=${HIDE}&page=2`);
    expect(echo.scrub("/next?q=p%40ss%20word!", HIDE)).toBe(`/next?q=${HIDE}`);
    expect(echo.has("p%40ss+word%21")).toBe(true);
    expect(echo.scrub("p%40ss+word", HIDE)).toBe("p%40ss+word");
  });

  it("hides a short value only where it is the whole text", () => {
    const echo = new SecretEcho();
    const pin = "123".slice(0, MIN_SCRUBBED_INSIDE - 1);
    echo.add(pin);
    expect(echo.scrub(pin, HIDE)).toBe(HIDE);
    expect(echo.scrub(`Total ${pin}0`, HIDE)).toBe(`Total ${pin}0`);
  });

  it("forgets every value when cleared", () => {
    const echo = new SecretEcho();
    echo.add("hunter2-hunter2");
    echo.clear();
    expect(echo.size).toBe(0);
    expect(echo.scrub("hunter2-hunter2", HIDE)).toBe("hunter2-hunter2");
  });

  it("stays fast on a long page", () => {
    const echo = new SecretEcho();
    echo.add("correct-horse-battery");
    echo.add("1234-5678");
    const page = "lorem ipsum dolor sit amet ".repeat(4_000);
    const started = performance.now();
    expect(echo.scrub(`${page}correct-horse-battery`, HIDE).endsWith(HIDE)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
