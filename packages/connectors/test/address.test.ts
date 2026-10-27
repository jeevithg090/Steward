import { describe, expect, it } from "vitest";
import {
  assertPublicHost,
  BlockedAddressError,
  canonicalHost,
  checkWebAddress,
  classifyHostname,
  classifyIp,
  type LookupFn,
} from "../src/net/address.ts";

const fakeDns =
  (table: Record<string, string[]>): LookupFn =>
  async (host) => {
    const addresses = table[host];
    if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };

describe("checkWebAddress", () => {
  it.each([
    "http://localhost:8787/api/info",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0.0.0.0:5432/",
    "http://10.1.2.3/",
    "http://172.16.0.9/",
    "http://172.31.255.1/",
    "http://192.168.1.1/",
    "http://100.101.102.103/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[fd12:3456::1]/",
    "http://admin.localhost/",
    "http://LOCALHOST./",
  ])("refuses the private address %s", (url) => {
    const verdict = checkWebAddress(url);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error.addressClass).toBe("private");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.170.2/v2/credentials",
    "http://100.100.100.200/latest/meta-data",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://metadata.google.internal./",
    "http://[fd00:ec2::254]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[fe80::1]/",
  ])("refuses the metadata or link-local address %s, even with private hosts allowed", (url) => {
    const verdict = checkWebAddress(url, { allowPrivateHosts: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error.addressClass).toBe("forbidden");
  });

  it("allows loopback and private ranges when private hosts are allowed", () => {
    expect(checkWebAddress("http://127.0.0.1:8787/", { allowPrivateHosts: true }).ok).toBe(true);
    expect(checkWebAddress("http://192.168.0.10/", { allowPrivateHosts: true }).ok).toBe(true);
  });

  it("allows public addresses", () => {
    expect(checkWebAddress("https://example.com/page").ok).toBe(true);
    expect(checkWebAddress("http://93.184.215.14/").ok).toBe(true);
    expect(checkWebAddress("https://[2606:4700::6810:84e5]/").ok).toBe(true);
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/"])(
    "refuses the non-web scheme %s",
    (url) => {
      const verdict = checkWebAddress(url);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/Only web addresses/);
    },
  );

  it("refuses addresses that carry a user name or password", () => {
    const verdict = checkWebAddress("https://user:hunter2@example.com/");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error.addressClass).toBe("credentials");
      expect(verdict.reason).not.toContain("hunter2");
    }
  });

  it("explains how to allow local addresses in plain words", () => {
    const verdict = checkWebAddress("http://localhost/");
    expect(!verdict.ok && verdict.reason).toMatch(/STEWARD_ALLOW_PRIVATE_HOSTS=1/);
  });
});

describe("canonicalHost and classifyIp", () => {
  it("unwraps embedded IPv4 and drops the root dot", () => {
    expect(canonicalHost("[::ffff:7f00:1]")).toBe("127.0.0.1");
    expect(canonicalHost("Example.COM.")).toBe("example.com");
    expect(canonicalHost("[0:0:0:0:0:0:0:1]")).toBe("::1");
  });

  it("classifies resolved addresses", () => {
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("127.0.0.53")).toBe("private");
    expect(classifyIp("169.254.1.1")).toBe("forbidden");
    expect(classifyIp("::ffff:10.0.0.1")).toBe("private");
    expect(classifyIp("2001:4860:4860::8888")).toBe("public");
    expect(classifyIp("not-an-ip")).toBe("forbidden");
  });

  it("treats unresolved names as public until DNS says otherwise", () => {
    expect(classifyHostname("news.example.org")).toBe("public");
    expect(classifyHostname("metadata")).toBe("forbidden");
  });
});

describe("assertPublicHost", () => {
  const dns = fakeDns({
    "public.example": ["93.184.215.14"],
    "sneaky.example": ["93.184.215.14", "10.0.0.7"],
    "rebind.example": ["127.0.0.1"],
    "cloud.example": ["169.254.169.254"],
  });

  it("returns the checked addresses of a public name", async () => {
    await expect(assertPublicHost("public.example", { lookup: dns })).resolves.toEqual([
      { address: "93.184.215.14", family: 4 },
    ]);
  });

  it("refuses a public name when any of its addresses is private", async () => {
    await expect(assertPublicHost("sneaky.example", { lookup: dns })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await expect(assertPublicHost("rebind.example", { lookup: dns })).rejects.toThrow(/private network/);
  });

  it("allows a privately resolving name only with the opt-in, and never a metadata address", async () => {
    await expect(
      assertPublicHost("rebind.example", { lookup: dns, allowPrivateHosts: true }),
    ).resolves.toHaveLength(1);
    await expect(assertPublicHost("cloud.example", { lookup: dns, allowPrivateHosts: true })).rejects.toThrow(
      /metadata/,
    );
  });

  it("says plainly when a name does not exist", async () => {
    await expect(assertPublicHost("nowhere.example", { lookup: dns })).rejects.toThrow(
      /Couldn't find a website at nowhere.example/,
    );
  });
});
