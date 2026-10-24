import { type KeyStore, type WrappedKey, deviceUserKey, prfUserKey, recoveryCode } from "@/lib/crypto";

class MemoryKeyStore implements KeyStore {
  value: WrappedKey | null = null;
  load = async () => this.value;
  save = async (v: WrappedKey) => void (this.value = v);
}

test("the device key is made once, stored only wrapped, and comes back the same", async () => {
  const store = new MemoryKeyStore();

  const first = await deviceUserKey(store);
  const again = await deviceUserKey(store);

  expect(first).toHaveLength(32);
  expect(again).toEqual(first);
  expect(store.value!.wrappingKey.extractable).toBe(false); // the browser won't hand it out
  expect(new Uint8Array(store.value!.wrapped)).not.toEqual(first); // only ciphertext is stored
});

test("a passkey's PRF output derives the same key every time; no PRF means no key", async () => {
  const prf = new Uint8Array(32).fill(7);
  const credential = { getClientExtensionResults: () => ({ prf: { results: { first: prf } } }) as AuthenticationExtensionsClientOutputs };

  const a = await prfUserKey(credential);
  const b = await prfUserKey(credential);

  expect(a).toEqual(b);
  expect(a).toHaveLength(32);
  expect(a).not.toEqual(prf);
  expect(await prfUserKey({ getClientExtensionResults: () => ({}) })).toBeNull();
});

test("the recovery code matches the Gateway's format (shared test vector)", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);

  expect(recoveryCode(key)).toBe("AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ");
});
