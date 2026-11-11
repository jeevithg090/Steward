import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guardProcess } from "../src/crash.ts";

describe("guardProcess", () => {
  it("logs a promise nothing waited for and keeps serving", () => {
    const target = new EventEmitter();
    const lines: string[] = [];
    const stops: string[] = [];
    guardProcess(
      target as unknown as NodeJS.Process,
      (why) => stops.push(why),
      (line) => lines.push(line),
    );
    target.emit("unhandledRejection", new Error("the relay went away"));
    target.emit("unhandledRejection", "a bare string");
    expect(lines).toEqual([
      "[steward] something in the background failed: the relay went away",
      "[steward] something in the background failed: a bare string",
    ]);
    expect(stops).toEqual([]);
  });

  it("closes Steward after an exception nothing caught, logging only its message", () => {
    const target = new EventEmitter();
    const lines: string[] = [];
    const stops: string[] = [];
    guardProcess(
      target as unknown as NodeJS.Process,
      (why) => stops.push(why),
      (line) => lines.push(line),
    );
    const err = Object.assign(new Error("broken state"), { body: "what a tool returned" });
    target.emit("uncaughtException", err);
    expect(stops).toEqual(["error"]);
    expect(lines).toEqual(["[steward] stopping after an unexpected error: broken state"]);
    expect(lines.join("")).not.toContain("what a tool returned");
  });

  it("keeps a real process alive past an unhandled rejection", () => {
    const crash = fileURLToPath(new URL("../src/crash.ts", import.meta.url));
    const script = `
      const { guardProcess } = await import(${JSON.stringify(crash)});
      guardProcess(process, () => process.exit(3));
      Promise.reject(new Error("nobody waited"));
      setTimeout(() => console.log("still serving"), 50);
    `;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("still serving");
    expect(out.stderr).toContain("[steward] something in the background failed: nobody waited");
  });
});
