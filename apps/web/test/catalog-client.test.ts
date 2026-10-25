import { CatalogClient, GatewayError } from "@/lib/catalog-client";

type Call = { url: string; init: RequestInit };

function fake(status: number, body: unknown, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

test("profiles and skills are unwrapped from the Gateway's envelopes, with the bearer", async () => {
  const calls: Call[] = [];
  const client = new CatalogClient({ url: "http://gw.test", token: "t0k" }, fake(200, { profiles: [{ id: "commuter" }], skills: [{ id: "rights-decay" }] }, calls));

  expect(await client.profiles()).toEqual([{ id: "commuter" }]);
  expect(await client.skills()).toEqual([{ id: "rights-decay" }]);
  expect(calls.map((c) => c.url)).toEqual(["http://gw.test/profiles", "http://gw.test/skills"]);
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t0k");
});

test("import posts the code and surfaces the Gateway's plain reason on 422 and 413", async () => {
  const calls: Call[] = [];
  const client = new CatalogClient({ url: "http://gw.test", token: "t" }, fake(422, { detail: "\"claim\" is in both may and may_not" }, calls));

  const error = await client.importProfile("tp1.abc").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GatewayError);
  expect((error as GatewayError).status).toBe(422);
  expect((error as GatewayError).message).toBe('"claim" is in both may and may_not');
  expect(calls[0]!.init.method).toBe("POST");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: "tp1.abc" });

  const big = new CatalogClient({ url: "http://gw.test", token: "t" }, fake(413, "Request Entity Too Large", []));
  await expect(big.importProfile("tp1.x")).rejects.toThrow("POST /profiles/import: HTTP 413");
});

test("pydantic's 422 array is turned into one sentence", async () => {
  const client = new CatalogClient(
    { url: "http://gw.test", token: "t" },
    fake(422, { detail: [{ type: "missing", loc: ["body", "code"], msg: "Field required" }] }, []),
  );

  await expect(client.importProfile("")).rejects.toThrow("Field required (code)");
});

test("letters go to /letters/read and /letters/reply", async () => {
  const calls: Call[] = [];
  const client = new CatalogClient({ url: "http://gw.test", token: "t" }, fake(200, { kind: "x" }, calls));

  await client.readLetter({ image_b64: "AAAA", filename: "letter.jpg" });
  await client.reply({ reading: { kind: "x" } as never, said: "no thanks" });

  expect(calls.map((c) => c.url)).toEqual(["http://gw.test/letters/read", "http://gw.test/letters/reply"]);
  expect((await client.sampleLetters()).map((l) => l.id)).toEqual(["thames-water-overpayment", "council-tax-reminder"]);
});
