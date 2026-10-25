import { CONFIG, fakeMesh } from "@/features/devices/fakes";
import { Gateway, type MissionView } from "./api";
import { SIGNED_ANSWER_NEEDED, answerAsk } from "./approve";

const VIEW = { id: "m_1", state: "waiting" } as MissionView;

test("a device that signs answers with its passkey, never the bearer", async () => {
  const { mesh } = fakeMesh({
    "POST /mesh/approvals/r1/options": { challenge_id: "c1", options: { challenge: "AQI" } },
    "POST /mesh/approvals/r1": VIEW,
  });
  const gateway = new Gateway(CONFIG);
  gateway.answer = vi.fn();
  expect(await answerAsk({ gateway, mesh, signs: true }, "r1", true)).toEqual(VIEW);
  expect(gateway.answer).not.toHaveBeenCalled();
});

test("without a passkey here it uses the bearer, and a refusal because Face ID is set up elsewhere is said plainly", async () => {
  const { mesh } = fakeMesh({}, { id: null });
  const ok = new Gateway(CONFIG, (async () => new Response(JSON.stringify(VIEW))) as typeof fetch);
  expect(await answerAsk({ gateway: ok, mesh, signs: false }, "r1", true)).toEqual(VIEW);

  const refused = new Gateway(CONFIG, (async () => new Response(JSON.stringify({ detail: "approve with your passkey" }), { status: 403 })) as typeof fetch);
  await expect(answerAsk({ gateway: refused, mesh, signs: false }, "r1", true)).rejects.toThrow(SIGNED_ANSWER_NEEDED);
});
