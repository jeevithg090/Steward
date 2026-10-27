import { describe, expect, it } from "vitest";
import { isComputerError } from "../src/errors.ts";
import {
  canonicalHost,
  classifyAddress,
  displayUrl,
  HostPolicy,
  type LookupFn,
  parseIpv6,
  parseWebUrl,
} from "../src/network.ts";

function fakeLookup(table: Record<string, string[]>): LookupFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (host: string) => {
    calls.push(host);
    const answers = table[host];
    if (!answers) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return answers.map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }));
  };
  return Object.assign(fn, { calls });
}

describe("address classification", () => {
  it("always marks cloud metadata endpoints", () => {
    for (const ip of [
      "169.254.169.254",
      "169.254.170.2",
      "100.100.100.200",
      "fd00:ec2::254",
      "168.63.129.16",
    ]) {
      expect(classifyAddress(ip), ip).toBe("metadata");
    }
  });

  it("marks loopback, private, link-local and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.8.9.10",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.10.10",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
    ]) {
      expect(classifyAddress(ip), ip).toBe("private");
    }
  });

  it("sees through IPv4 wrapped in IPv6", () => {
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("private");
    expect(classifyAddress("::ffff:7f00:1")).toBe("private");
    expect(classifyAddress("::ffff:169.254.169.254")).toBe("metadata");
    expect(classifyAddress("64:ff9b::a9fe:a9fe")).toBe("metadata");
    expect(classifyAddress("2002:c0a8:0101::1")).toBe("private"); // 6to4 of 192.168.1.1
    expect(classifyAddress("::ffff:8.8.8.8")).toBe("public");
  });

  it("leaves the public internet alone and rejects non-addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
      expect(classifyAddress(ip), ip).toBe("public");
    }
    expect(classifyAddress("example.com")).toBeUndefined();
    expect(classifyAddress("1.2.3")).toBeUndefined();
    expect(classifyAddress("1:2:3:4:5:6:7:8:9")).toBeUndefined();
  });

  it("parses IPv6 forms", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("fe80::1%en0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIpv6("1::2::3")).toBeUndefined();
  });

  it("canonicalises hosts", () => {
    expect(canonicalHost("[::1]")).toBe("::1");
    expect(canonicalHost("Example.COM.")).toBe("example.com");
  });
});

describe("parseWebUrl", () => {
  it("accepts http and https, and reads a bare host as https", () => {
    expect(parseWebUrl("https://example.com/a?b=1").href).toBe("https://example.com/a?b=1");
    expect(parseWebUrl("news.ycombinator.com").href).toBe("https://news.ycombinator.com/");
  });

  it("refuses every other scheme before anything reaches the browser", () => {
    for (const url of [
      "file:///etc/passwd",
      "chrome://settings",
      "javascript:alert(1)",
      "data:text/html,<b>hi</b>",
      "ftp://example.com",
      "about:blank",
    ]) {
      let error: unknown;
      try {
        parseWebUrl(url);
      } catch (e) {
        error = e;
      }
      expect(isComputerError(error) && error.code === "bad_url", url).toBe(true);
    }
  });

  it("refuses credentials in the address and nonsense", () => {
    expect(() => parseWebUrl("https://user:pw@example.com")).toThrow(/secret box/);
    expect(() => parseWebUrl("")).toThrow(/web address/);
    expect(() => parseWebUrl("not a url")).toThrow(/not a web address/);
  });

  it("shows hosts and paths without query strings", () => {
    expect(displayUrl("https://example.com/reset?token=abc")).toBe("example.com/reset");
    expect(displayUrl("https://example.com/")).toBe("example.com");
  });
});

describe("HostPolicy", () => {
  it("refuses private and metadata hosts by default, with plain sentences", async () => {
    const policy = new HostPolicy({ lookup: fakeLookup({}) });
    const local = await policy.checkHost("127.0.0.1");
    expect(local).toMatchObject({ ok: false, reason: "private" });
    expect(!local.ok && local.message).toMatch(/private network/);
    expect(await policy.checkHost("localhost")).toMatchObject({ ok: false, reason: "private" });
    expect(await policy.checkHost("app.localhost")).toMatchObject({ ok: false, reason: "private" });
    expect(await policy.checkHost("[::1]")).toMatchObject({ ok: false, reason: "private" });
    expect(await policy.checkHost("metadata.google.internal")).toMatchObject({
      ok: false,
      reason: "metadata",
    });
  });

  it("allows private hosts when opted in, but never metadata", async () => {
    const policy = new HostPolicy({
      allowPrivateHosts: true,
      lookup: fakeLookup({ "meta.example": ["169.254.169.254"] }),
    });
    expect(await policy.checkHost("127.0.0.1")).toMatchObject({ ok: true });
    expect(await policy.checkHost("169.254.169.254")).toMatchObject({ ok: false, reason: "metadata" });
    expect(await policy.checkHost("meta.example")).toMatchObject({ ok: false, reason: "metadata" });
  });

  it("resolves names and refuses when any address is private", async () => {
    const lookup = fakeLookup({
      "public.example": ["93.184.216.34"],
      "sneaky.example": ["93.184.216.34", "10.0.0.5"],
      "dual.example": ["2606:2800:220:1::1", "93.184.216.34"],
    });
    const policy = new HostPolicy({ lookup });
    expect(await policy.checkHost("public.example")).toMatchObject({
      ok: true,
      addresses: [{ address: "93.184.216.34" }],
    });
    expect(await policy.checkHost("sneaky.example")).toMatchObject({ ok: false, reason: "private" });
    const dual = await policy.checkHost("dual.example");
    expect(dual.ok && dual.addresses[0]?.family).toBe(4);
    expect(await policy.checkHost("missing.example")).toMatchObject({ ok: false, reason: "unresolved" });
  });

  it("caches answers briefly", async () => {
    let now = 0;
    const lookup = fakeLookup({ "a.example": ["93.184.216.34"] });
    const policy = new HostPolicy({ lookup, cacheMs: 1000, now: () => now });
    await policy.checkHost("a.example");
    await policy.checkHost("A.Example.");
    expect(lookup.calls).toEqual(["a.example"]);
    now = 1500;
    await policy.checkHost("a.example");
    expect(lookup.calls).toHaveLength(2);
  });

  it("checks only web schemes", async () => {
    const policy = new HostPolicy({ allowPrivateHosts: true, lookup: fakeLookup({}) });
    expect(await policy.checkUrl(new URL("ws://127.0.0.1:1/x"))).toMatchObject({ ok: true });
    expect(await policy.checkUrl(new URL("file:///etc/hosts"))).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});
