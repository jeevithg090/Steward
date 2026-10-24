import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonical, coseXY, derToRaw, type Envelope, verifyMandate } from "@/lib/passport";

// The same signed mandate the Python tests make (tests/unit/test_passport.py): Python is the oracle.
const FIXTURE = resolve(__dirname, "../../../fixtures/passport/signed_mandate.json");
const signed = (): Envelope => JSON.parse(readFileSync(FIXTURE, "utf-8")) as Envelope;
const NOW = new Date("2026-10-25T12:00:00Z"); // inside the fixture's window

test("a browser verifies the mandate Python signed, with nothing but WebCrypto", async () => {
  expect(await verifyMandate(signed(), NOW)).toBe("ok");
});

test("changing one word breaks the signature", async () => {
  const tampered = signed();
  tampered.mandate.counterparty = "Someone Else";

  expect(await verifyMandate(tampered, NOW)).toBe("bad_signature");
});

test("time matters: before it starts, and after it ends", async () => {
  expect(await verifyMandate(signed(), new Date("2020-01-01T00:00:00Z"))).toBe("not_yet_valid");
  expect(await verifyMandate(signed(), new Date("2030-01-01T00:00:00Z"))).toBe("expired");
});

test("a key it can't use, or a version it doesn't know, is refused", async () => {
  const noKey = signed();
  (noKey.mandate.principal as { key: { public_key: string } }).key.public_key = "AAAA";
  const future = signed();
  future.mandate.v = 2;

  expect(await verifyMandate(noKey, NOW)).toBe("bad_key");
  expect(await verifyMandate(future, NOW)).toBe("unknown_version");
});

test("the canonical form sorts keys at every level and has no spaces", () => {
  expect(canonical({ b: 1, a: { d: [1, "x"], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
});

test("the small CBOR and DER readers refuse what they don't understand", () => {
  expect(coseXY(new Uint8Array([0x80]))).toBeNull();
  expect(derToRaw(new Uint8Array([0x31, 0x00]))).toBeNull();
});
