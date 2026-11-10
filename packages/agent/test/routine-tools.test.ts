import type { Routine, RoutineStore } from "@steward/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOLS } from "../src/tools/catalogue.ts";
import type { ToolArgs, ToolContext } from "../src/tools/types.ts";
import { type Fakes, makeFakes, servicesFrom } from "./fakes.ts";

let fakes: Fakes;
let ctx: ToolContext;
let brief: Routine;

beforeEach(() => {
  fakes = makeFakes();
  // The shared fake cannot change or remove a routine; these tests need it to.
  const store = fakes.routines;
  const editable: Pick<RoutineStore, "update" | "remove"> = {
    update: (id, patch) => {
      const found = store.routines.find((r) => r.id === id);
      if (!found) throw new Error("no routine");
      Object.assign(found, patch);
      return found;
    },
    remove: (id) => {
      store.routines.splice(
        store.routines.findIndex((r) => r.id === id),
        1,
      );
    },
  };
  Object.assign(store, editable);
  ctx = {
    agentId: "steward",
    threadId: "thr_1",
    runId: "run_1",
    toolCallId: "call_1",
    signal: new AbortController().signal,
    services: servicesFrom(fakes),
  };
  brief = store.create({
    title: "Morning brief",
    prompt: "Tell me what needs me",
    schedule: "0 8 * * 1-5",
    timezone: "Europe/London",
    enabled: true,
    agentId: "steward",
  });
  store.create({
    title: "Bot's own",
    prompt: "Something for the bot",
    schedule: "0 9 * * *",
    timezone: "Europe/London",
    enabled: true,
    agentId: "helper",
  });
});

const run = (name: string, args: ToolArgs) => {
  const found = BUILTIN_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.execute(args, ctx);
};

describe("routine_list", () => {
  it("lists this agent's routines only", async () => {
    const list = (await run("routine_list", {})) as { id: string; title: string }[];
    expect(list).toEqual([
      expect.objectContaining({
        id: brief.id,
        title: "Morning brief",
        schedule: "0 8 * * 1-5",
        enabled: true,
      }),
    ]);
  });
});

describe("routine_update", () => {
  it("changes only what it names", async () => {
    const updated = await run("routine_update", {
      id: brief.id,
      title: "Morning brief",
      schedule: "0 9 * * 1-5",
    });
    expect(updated).toMatchObject({
      title: "Morning brief",
      schedule: "0 9 * * 1-5",
      prompt: "Tell me what needs me",
    });
    await run("routine_update", { id: brief.id, title: "morning BRIEF", newTitle: "Brief", enabled: false });
    expect(fakes.routines.get(brief.id)).toMatchObject({ title: "Brief", enabled: false });
  });

  it("refuses a routine that is not this agent's, a wrong name, and nothing to change", async () => {
    const other = fakes.routines.routines.find((r) => r.agentId === "helper");
    await expect(
      run("routine_update", { id: other?.id, title: "Bot's own", enabled: false }),
    ).rejects.toThrow(/no routine with that id/);
    await expect(
      run("routine_update", { id: brief.id, title: "Evening digest", enabled: false }),
    ).rejects.toThrow(/called "Morning brief"/);
    await expect(run("routine_update", { id: brief.id, title: "Morning brief" })).rejects.toThrow(
      /at least one/,
    );
    await expect(
      run("routine_update", { id: brief.id, title: "Morning brief", schedule: "at nine" }),
    ).rejects.toThrow(/five-field cron/);
    await expect(
      run("routine_update", { id: brief.id, title: "Morning brief", timezone: "Mars/Base" }),
    ).rejects.toThrow(/not a timezone/);
    expect(fakes.routines.get(brief.id)).toMatchObject({ enabled: true, schedule: "0 8 * * 1-5" });
  });
});

describe("routine_delete", () => {
  it("deletes this agent's routine by id and name", async () => {
    await expect(run("routine_delete", { id: brief.id, title: "Something else" })).rejects.toThrow(/called/);
    expect(await run("routine_delete", { id: brief.id, title: "Morning brief" })).toEqual({
      deleted: true,
      id: brief.id,
      title: "Morning brief",
    });
    expect(fakes.routines.get(brief.id)).toBeUndefined();
  });
});
