import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
  answerMessage,
  boxKey,
  boxKeyPairFromSecretKey,
  boxOpen,
  boxSeal,
  challengeFor,
  concat,
  confirmationCode,
  decryptPayload,
  derToP1363,
  encryptPayload,
  exportPublicKey,
  formatRecoveryKey,
  fromBase64,
  fromHex,
  generateSigningKey,
  importDataKey,
  isRemoteMethod,
  NEVER_REMOTE,
  openBox,
  openJson,
  pairingUrl,
  parsePairingFragment,
  parseRecoveryKey,
  REMOTE_METHODS,
  randomBytes,
  sealBox,
  sealJson,
  secretBoxOpen,
  secretBoxSeal,
  sha256,
  signText,
  toBase64,
  toBase64Url,
  toHex,
  unwrapDataKey,
  utf8,
  verifyAssertion,
  verifyText,
  wrapDataKey,
} from "../src/index.ts";
import { EXPECTED, KEY_TREE, NACL_BEFORENM, RFC7748, runVectors } from "../src/vectors.ts";

describe("the shared vectors", () => {
  it("come out the same as the pinned results, and secretbox matches TweetNaCl", async () => {
    expect(await runVectors()).toEqual(EXPECTED);
    const theirs = nacl.secretbox(utf8("steward"), new Uint8Array(24), fromHex(NACL_BEFORENM));
    expect(toHex(theirs)).toBe(EXPECTED.secretbox);
  });
});

describe("NaCl on @noble", () => {
  it("matches RFC 7748 and NaCl's own beforenm vector", async () => {
    const results = await runVectors();
    expect(results.alicePublic).toBe(RFC7748.alicePublic);
    expect(results.beforenm).toBe(NACL_BEFORENM);
    expect(toHex(boxKeyPairFromSecretKey(fromHex(RFC7748.bobSecret)).publicKey)).toBe(RFC7748.bobPublic);
  });

  it("seals the same bytes as TweetNaCl, and opens TweetNaCl's", async () => {
    for (let i = 0; i < 20; i++) {
      const a = nacl.box.keyPair();
      const b = nacl.box.keyPair();
      const nonce = randomBytes(24);
      const message = randomBytes(1 + i * 37);
      const ours = await boxSeal(message, nonce, b.publicKey, a.secretKey);
      const theirs = nacl.box(message, nonce, b.publicKey, a.secretKey);
      expect(toHex(ours)).toBe(toHex(theirs));
      expect(await boxOpen(theirs, nonce, a.publicKey, b.secretKey)).toEqual(message);
      const key = randomBytes(32);
      expect(toHex(secretBoxSeal(message, nonce, key))).toBe(toHex(nacl.secretbox(message, nonce, key)));
      expect(secretBoxOpen(nacl.secretbox(message, nonce, key), nonce, key)).toEqual(message);
    }
  });

  it("refuses a tampered box", async () => {
    const key = randomBytes(32);
    const nonce = randomBytes(24);
    const sealed = secretBoxSeal(utf8("hi"), nonce, key);
    sealed[sealed.length - 1]! ^= 1;
    expect(secretBoxOpen(sealed, nonce, key)).toBeUndefined();
  });

  it("gives the same box key from a WebCrypto X25519 key as from its raw bytes", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const raw = fromBase64(jwk.d!);
    const peer = nacl.box.keyPair();
    expect(toHex(await boxKey(peer.publicKey, pair.privateKey))).toBe(
      toHex(await boxKey(peer.publicKey, raw)),
    );
    // A non-extractable key works the same, and cannot be read back.
    const locked = (await crypto.subtle.generateKey({ name: "X25519" }, false, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const lockedPublic = new Uint8Array(await crypto.subtle.exportKey("raw", locked.publicKey));
    const sealed = await sealJson({ dataKey: "x" }, lockedPublic);
    expect(await openJson(sealed, locked.privateKey)).toEqual({ dataKey: "x" });
    await expect(crypto.subtle.exportKey("jwk", locked.privateKey)).rejects.toThrow();
  });
});

describe("the key tree (Happy's vectors, Steward's usage strings)", () => {
  it("derives Happy's test vector", async () => {
    expect((await runVectors()).keyTree).toBe(KEY_TREE.finalKey);
  });
});

describe("payloads", () => {
  it("are 0x00 | nonce | AES-GCM | tag, and open only with the right key", async () => {
    const key = randomBytes(32);
    const sealed = await encryptPayload(key, { say: "hello" });
    expect(sealed[0]).toBe(0);
    expect(sealed.length).toBe(1 + 12 + JSON.stringify({ say: "hello" }).length + 16);
    expect(await decryptPayload(key, sealed)).toEqual({ say: "hello" });
    expect(await decryptPayload(randomBytes(32), sealed)).toBeUndefined();
    const bent = sealed.slice();
    bent[20]! ^= 1;
    expect(await decryptPayload(key, bent)).toBeUndefined();
    expect(await decryptPayload(key, concat(new Uint8Array([1]), sealed.slice(1)))).toBeUndefined();
  });

  it("work with a non-extractable WebCrypto key, as the phone keeps it", async () => {
    const raw = randomBytes(32);
    const key = await importDataKey(raw);
    expect(key.extractable).toBe(false);
    expect(await decryptPayload(raw, await encryptPayload(key, [1, 2]))).toEqual([1, 2]);
  });

  it("are pinned: the same input gives the same bytes in every runtime", async () => {
    const results = await runVectors();
    expect(results.payloadOpens).toBe(true);
    expect(results.payload).toMatch(/^00000102030405060708090a0b[0-9a-f]+$/);
  });
});

describe("sealed boxes and data keys", () => {
  it("seal to a public key, and only its secret opens them", async () => {
    const me = nacl.box.keyPair();
    const other = nacl.box.keyPair();
    const sealed = await sealBox(utf8("secret"), me.publicKey);
    expect(await openBox(sealed, me.secretKey)).toEqual(utf8("secret"));
    expect(await openBox(sealed, other.secretKey)).toBeUndefined();
    const dataKey = randomBytes(32);
    const wrapped = await wrapDataKey(dataKey, me.publicKey);
    expect(wrapped[0]).toBe(0);
    expect(await unwrapDataKey(wrapped, me.secretKey)).toEqual(dataKey);
    expect(await unwrapDataKey(wrapped, other.secretKey)).toBeUndefined();
  });
});

describe("recovery keys", () => {
  it("round-trip in groups of five, forgiving case, dashes and look-alikes", () => {
    const key = randomBytes(32);
    const text = formatRecoveryKey(key);
    expect(text).toMatch(/^([A-Z2-7]{5}-){10}[A-Z2-7]{2}$/);
    expect(parseRecoveryKey(text.toLowerCase().replace(/-/g, " "))).toEqual(key);
    expect(formatRecoveryKey(new Uint8Array(32))).toBe(
      "AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AA",
    );
    // Someone copying it out by hand writes 0 for O, 1 for I and 8 for B.
    const typed = text.replace(/O/g, "0").replace(/I/g, "1").replace(/B/g, "8");
    expect(parseRecoveryKey(typed)).toEqual(key);
    expect(() => parseRecoveryKey("ABC")).toThrow(/32/);
  });
});

describe("pairing", () => {
  it("shows the same code on both screens, and a different one if a key was swapped", async () => {
    const eph = toBase64(randomBytes(32));
    const box = toBase64(randomBytes(32));
    const sign = toBase64(randomBytes(91));
    const code = await confirmationCode(eph, box, sign);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await confirmationCode(eph, box, sign)).toBe(code);
    expect(await confirmationCode(eph, toBase64(randomBytes(32)), sign)).not.toBe(code);
  });

  it("keeps the one-time key in the address's fragment, which browsers never send", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const key = toBase64Url(randomBytes(32));
    const url = pairingUrl("wss://relay.example.com/", id, key);
    expect(url).toBe(`https://relay.example.com/#pair=${id}.${key}`);
    expect(parsePairingFragment(new URL(url).hash)).toEqual({ pairingId: id, key });
    expect(parsePairingFragment("#pair=nope")).toBeUndefined();
  });
});

describe("the closed RPC list", () => {
  it("is exactly the plan's seven methods, and never rules, settings, secrets, shell or the computer", () => {
    expect([...REMOTE_METHODS]).toEqual([
      "approval.decide",
      "chat.send",
      "task.start",
      "task.hide",
      "routine.run",
      "run.stop",
      "brief.get",
    ]);
    for (const m of [
      "shell.run",
      "rules.update",
      "settings.update",
      "computer.input",
      "secrets.get",
      "bash",
    ]) {
      expect(isRemoteMethod(m)).toBe(false);
    }
    for (const word of NEVER_REMOTE) expect(REMOTE_METHODS.some((m) => m.includes(word))).toBe(false);
  });
});

describe("signed answers", () => {
  it("verify with the device's key, and fail when anything changes", async () => {
    const pair = await generateSigningKey();
    expect(pair.privateKey.extractable).toBe(false);
    const pub = await exportPublicKey(pair.publicKey);
    const message = answerMessage("dev_1", { approvalId: "apr_1", answer: "once", nonce: "n1", ts: 1 });
    const sig = await signText(pair.privateKey, message);
    expect(await verifyText(pub, message, sig)).toBe(true);
    expect(await verifyText(pub, message.replace("once", "refuse"), sig)).toBe(false);
    expect(
      await verifyText(
        pub,
        answerMessage("dev_2", { approvalId: "apr_1", answer: "once", nonce: "n1", ts: 1 }),
        sig,
      ),
    ).toBe(false);
    const other = await exportPublicKey((await generateSigningKey()).publicKey);
    expect(await verifyText(other, message, sig)).toBe(false);
    expect(await verifyText("garbage", message, sig)).toBe(false);
  });
});

describe("WebAuthn assertions", () => {
  const rpId = "relay.example.com";
  const origin = "https://relay.example.com";

  /** What an authenticator returns, made here with a P-256 key. */
  async function assertion(opts: { flags?: number; challenge: Uint8Array; origin?: string; type?: string }) {
    const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey)));
    const authData = concat(
      await sha256(utf8(rpId)),
      new Uint8Array([opts.flags ?? 0x05]),
      new Uint8Array([0, 0, 0, 1]),
    );
    const clientData = utf8(
      JSON.stringify({
        type: opts.type ?? "webauthn.get",
        challenge: toBase64Url(opts.challenge),
        origin: opts.origin ?? origin,
      }),
    );
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        concat(authData, await sha256(clientData)) as BufferSource,
      ),
    );
    // Authenticators return DER; build it from r || s.
    const int = (b: Uint8Array) => {
      let v = b;
      while (v.length > 1 && v[0] === 0 && v[1]! < 0x80) v = v.slice(1);
      if (v[0]! >= 0x80) v = concat(new Uint8Array([0]), v);
      return concat(new Uint8Array([0x02, v.length]), v);
    };
    const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
    const der = concat(new Uint8Array([0x30, body.length]), body);
    expect(derToP1363(der)).toEqual(raw);
    return {
      publicKey,
      authenticatorData: toBase64(authData),
      clientDataJSON: toBase64(clientData),
      signature: toBase64(der),
    };
  }

  it("accept Face ID checked for this answer, on this site", async () => {
    const challenge = await challengeFor("the answer");
    const a = await assertion({ challenge });
    expect(await verifyAssertion({ ...a, rpId, origin, challenge })).toBe(true);
  });

  it("refuse no user verification, another answer, another site, or a registration", async () => {
    const challenge = await challengeFor("the answer");
    const noUv = await assertion({ challenge, flags: 0x01 });
    expect(await verifyAssertion({ ...noUv, rpId, origin, challenge })).toBe(false);
    const other = await assertion({ challenge: await challengeFor("another answer") });
    expect(await verifyAssertion({ ...other, rpId, origin, challenge })).toBe(false);
    const site = await assertion({ challenge, origin: "https://evil.example" });
    expect(await verifyAssertion({ ...site, rpId, origin, challenge })).toBe(false);
    const create = await assertion({ challenge, type: "webauthn.create" });
    expect(await verifyAssertion({ ...create, rpId, origin, challenge })).toBe(false);
  });
});
