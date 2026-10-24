import { DEMO_MISSION, Gateway } from "@/lib/api";

test("calls send the bearer token and JSON", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "m_1", state: "awaiting_consent" }), { status: 201 });
  }) as typeof fetch;
  const gateway = new Gateway({ url: "http://gw.test", token: "t0k" }, fake);

  await gateway.start(DEMO_MISSION);

  expect(calls[0]!.url).toBe("http://gw.test/missions");
  expect(calls[0]!.init.method).toBe("POST");
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t0k");
  expect(JSON.parse(String(calls[0]!.init.body)).departure).toBe("08:12");
});

test("an approval sends a cap for offers made later on the call", async () => {
  let body = "";
  const fake = (async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  await new Gateway({ url: "http://gw.test", token: "t" }, fake).answer("r1", true);

  expect(JSON.parse(body)).toEqual({ approved: true, limits: { auto_accept_max_gbp: "50" } });
});

test("errors carry the status", async () => {
  const fake = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;

  await expect(new Gateway({ url: "http://gw.test", token: "" }, fake).missions()).rejects.toThrow("GET /missions: HTTP 401");
});

test("the events URL is a WebSocket URL with the token", () => {
  const gateway = new Gateway({ url: "https://gw.test", token: "a b" });

  expect(gateway.eventsUrl()).toBe("wss://gw.test/events?token=a%20b");
});
