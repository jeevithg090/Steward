// Each conversation's status in History (plan.md §19): yellow while Tempo works on it, green when
// it's done with something new the person hasn't seen, grey once it's done and seen.
import type { MissionView } from "@/lib/api";
import { chatStatus, chatStore } from "./store";

const status = (id: string) => chatStatus(chatStore.find(id)!);

beforeEach(() => {
  localStorage.clear();
  chatStore.reset();
  chatStore.setViewing(false);
});
afterAll(() => chatStore.setViewing(false));

test("live while a turn is on its way; finished when the reply lands out of sight; read once it's on screen", () => {
  const id = chatStore.ensureActive("Hotels in Oxford");
  chatStore.appendTo(id, [{ id: "u1", role: "user", text: "Find hotels in Oxford" }], { pending: true });
  expect(status(id)).toBe("live");
  chatStore.appendTo(id, [{ id: "a1", role: "agent", text: "Here are five." }], { pending: false });
  expect(status(id)).toBe("finished"); // the chat page isn't showing it
  chatStore.setViewing(true);
  expect(status(id)).toBe("read");
});

test("a claim is live until it ends; ending while another chat is open is news; opening it reads it", () => {
  chatStore.setViewing(true);
  const id = chatStore.ensureActive("My train was late");
  chatStore.update(id, (c) => ({ ...c, missionId: "m_1", missionIds: ["m_1"], missionState: "waiting" }));
  expect(status(id)).toBe("live");
  chatStore.newChat(); // a fresh chat on screen
  chatStore.update(id, (c) => ({ ...c, missionState: "verified" }));
  expect(status(id)).toBe("finished");
  chatStore.setActive(id);
  expect(status(id)).toBe("read");
});

test("a question waiting for the person's yes is live", () => {
  chatStore.setViewing(true);
  const id = chatStore.ensureActive("The engineer never came");
  chatStore.update(id, (c) => ({ ...c, ask: { request_id: "r1", summary: "Shall I claim?", amount_gbp: "30.00" } as never }));
  expect(status(id)).toBe("live");
});

test("news survives a reload, a turn in flight does not; a mission found finished on the Gateway is news", () => {
  const id = chatStore.ensureActive("Hotels");
  chatStore.appendTo(id, [{ id: "a1", role: "agent", text: "Here." }], { pending: true });
  chatStore.reload();
  const again = chatStore.find(id)!;
  expect(again.pending).toBe(false);
  expect(again.unread).toBe(true);

  const done = { id: "m_done", user_id: "u_margaret", state: "verified", message: "Paid.", ask: null } as unknown as MissionView;
  const [found] = chatStore.syncMissions([done]);
  expect(chatStatus(found!)).toBe("finished");
});
