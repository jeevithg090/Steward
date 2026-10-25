import { render, screen } from "@testing-library/react";
import { ControlClient } from "@/components/site/ControlClient";
import { DEMO_BROADBAND, DEMO_MISSION } from "@/lib/api";
import { SHOWCASE_LABEL, ShowcaseGateway, ShowcaseMesh, isShowcaseQuery } from "@/lib/showcase";

test("Margaret's claim walks from awaiting_consent to verified with answer and tick, and the ledger counts it", async () => {
  const gateway = new ShowcaseGateway();
  const before = await gateway.ledger();
  const missions = await gateway.missions();
  const rail = missions.find((m) => m.skill_id === "clawback.uk-rail-delay-repay" && m.state === "awaiting_consent")!;

  expect(missions.map((m) => m.state)).toEqual(["awaiting_consent", "awaiting_consent", "verified"]); // seed: broadband, rail, Amir
  expect(rail.ask?.amount_gbp).toBe("14.20");
  expect(rail.ask?.proof_trace?.steps[0]?.citation_url).toContain("gwr.com");
  expect(rail.court?.verdicts).toHaveLength(3);

  const waiting = await gateway.answer(rail.ask!.request_id, true);
  expect(waiting.state).toBe("waiting");
  expect(waiting.message).toMatch(/Claim filed/);
  expect((await gateway.mission(rail.id)).state).toBe("waiting");

  const { fired } = await gateway.tick();
  expect(fired).toEqual([rail.id]);
  const verified = await gateway.mission(rail.id);
  expect(verified.state).toBe("verified");
  expect(verified.outcome?.amount_gbp).toBe("14.20");
  expect(verified.timeline.map((t) => t.to)).toContain("verified");

  const after = await gateway.ledger();
  expect(before).toEqual({ minutes_returned: "20", hours_returned: "0.3", gbp_recovered: "28.40" });
  expect(after).toEqual({ minutes_returned: "40", hours_returned: "0.7", gbp_recovered: "42.60" });
  expect(await gateway.tick()).toEqual({ fired: [] });
});

test("saying no declines; answering twice is a 404, as the Gateway does", async () => {
  const gateway = new ShowcaseGateway();
  const rail = (await gateway.missions()).find((m) => m.skill_id === "clawback.uk-rail-delay-repay")!;

  const declined = await gateway.answer(rail.ask!.request_id, false);
  expect(declined.state).toBe("declined");
  expect(declined.message).toBe("Stopped: you said no. Nothing was sent.");
  await expect(gateway.answer(rail.ask!.request_id, true)).rejects.toThrow("nothing is waiting");
});

test("the broadband case waits on purpose; the clock jump makes it act, or finds it paid", async () => {
  const gateway = new ShowcaseGateway();
  const first = (await gateway.missions()).find((m) => m.plan)!;
  expect(first.plan?.action_today).toBe("wait");

  // Path one: approve, jump 31 days, Tempo complains once, the money arrives on the next check.
  const waiting = await gateway.answer(first.ask!.request_id, true);
  expect(waiting.state).toBe("waiting");
  expect(waiting.plan?.action_today).toBe("wait");
  expect((await gateway.tick()).fired).toEqual([]); // its timer is on 19 November
  const jump = await gateway.advanceClock(31);
  expect(jump.offset_days).toBe(31);
  expect(jump.fired).toEqual([first.id]);
  expect((await gateway.health()).clock_offset_days).toBe(31);
  const acting = await gateway.mission(first.id);
  expect(acting.state).toBe("waiting");
  expect(acting.plan?.action_today).toBe("ofcom.complaint");
  expect(acting.message).toMatch(/Complaint made/);
  await gateway.tick();
  expect((await gateway.mission(first.id)).message).toMatch(/Broadbandly \(a simulated company\) has paid you £32.31/);

  // Path two: a new case, the credit arrives before the jump, nobody calls.
  const second = await gateway.startOfcom(DEMO_BROADBAND);
  expect(second.id).not.toBe(first.id);
  expect(second.ask?.request_id).not.toBe(first.ask?.request_id);
  await gateway.answer(second.ask!.request_id, true);
  expect(await gateway.creditArrives(second.id)).toEqual({ credited: true });
  await gateway.advanceClock(31);
  const paid = await gateway.mission(second.id);
  expect(paid.state).toBe("verified");
  expect(paid.message).toMatch(/paid the £32.31 on its own, so nobody had to call/);
  expect((await gateway.ledger()).gbp_recovered).toBe("93.02"); // 28.40 + 32.31 + 32.31
});

test("start makes a new claim (newest first); the card reading asks its one question; stop is the kill switch", async () => {
  const gateway = new ShowcaseGateway();
  const started = await gateway.start(DEMO_MISSION);
  expect(started.state).toBe("awaiting_consent");
  expect((await gateway.missions())[0]?.id).toBe(started.id);

  const other = await gateway.start({ ...DEMO_MISSION, departure: "09:12" });
  expect(other.state).toBe("declined");

  const read = await gateway.readCard({});
  expect(read.question).toMatch(/19 October 2026/);
  expect(read.visit?.event_date).toBe("2026-10-19");
  expect(read.mission).toBeUndefined();

  const stopped = await gateway.stop(started.id);
  expect(stopped.state).toBe("declined");
  await expect(gateway.mission("m_nope")).rejects.toThrow("HTTP 404");
  expect(gateway.eventsUrl()).toBe("");
});

test("memories can be forgotten and corrected in memory; voice profiles are the recorded three", async () => {
  const gateway = new ShowcaseGateway();
  const card = await gateway.memories("u_margaret");
  const stammer = card.memories.access!.find((e) => e.item.text === "has a stammer")!;

  expect(await gateway.forgetMemory("u_margaret", stammer.item.id)).toEqual({ forgotten: true });
  expect((await gateway.memories("u_margaret")).memories.access!.map((e) => e.item.text)).toEqual(["needs more time to answer"]);

  const phone = card.memories.preference![0]!;
  const corrected = await gateway.correctMemory("u_margaret", phone.item.id, "prefers text updates");
  const now = (await gateway.memories("u_margaret")).memories.preference![0]!;
  expect(now.item.text).toBe("prefers text updates");
  expect(now.item.id).toBe(corrected.id);
  expect(now.earlier[0]?.superseded_by).toBe(corrected.id);

  const moved = card.timeline.find((f) => f.episode_id === "seed_bb_slot_1")!;
  await gateway.forgetEpisode("u_margaret", moved.episode_id);
  expect((await gateway.memories("u_margaret")).timeline.some((f) => f.episode_id === "seed_bb_slot_1")).toBe(false);

  expect((await gateway.voiceProfile("u_dilip")).profile.language).toBe("hi");
  expect((await gateway.voiceProfile("u_joan")).profile.voice).toBe("low");
  expect((await gateway.voiceProfile("u_margaret")).profile.stammer).toBe(true);
  await expect(gateway.voiceProfile("u_nobody")).rejects.toThrow("404");
  expect((await gateway.memories("u_dilip")).timeline).toEqual([]);
});

test("the showcase Mesh has no devices and never fetches", async () => {
  const mesh = new ShowcaseMesh();

  expect(mesh.token).toBeNull();
  expect(mesh.deviceId).toBeNull();
  expect(await mesh.devices()).toEqual([]);
  expect(await mesh.enablePush()).toBe(false);
  await expect(mesh.registerThisDevice("u_margaret", "This browser")).rejects.toThrow(/no Gateway in the showcase/);
  await expect(mesh.answer("r1", true)).rejects.toThrow(/no Gateway in the showcase/);
});

test("Mission Control runs on the showcase: Margaret's question, the honest badge, no Gateway error", async () => {
  render(<ControlClient showcase />);

  expect(await screen.findByRole("heading", { name: "Waiting for your OK" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes, claim £32.31" })).toBeInTheDocument(); // the newest mission is the broadband case
  expect(screen.getByRole("status")).toHaveTextContent("REPLAY data · SIMULATED COMPANY · JURORS · VISION");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect((await screen.findAllByText("has a stammer")).length).toBeGreaterThan(0); // Memory Card and Who's calling?
  expect(screen.getByRole("button", { name: "Use this device for approvals" })).toBeInTheDocument();
  expect(SHOWCASE_LABEL).toBe("SHOWCASE · recorded replay · no Gateway");
});

test("?showcase=1 switches a page on", () => {
  expect(isShowcaseQuery("?showcase=1")).toBe(true);
  expect(isShowcaseQuery("?a=b&showcase=1")).toBe(true);
  expect(isShowcaseQuery("?showcase=0")).toBe(false);
  expect(isShowcaseQuery("")).toBe(false);
  expect(isShowcaseQuery(null)).toBe(false);
});
