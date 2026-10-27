import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildMessage,
  decodeWords,
  formatAddress,
  headerValue,
  parseAddress,
  parseAddressList,
  parseMessage,
} from "../src/google/mime.ts";

describe("addresses", () => {
  it("parses the common forms", () => {
    expect(parseAddress("Helen Marsh <helen@lettings.test>")).toEqual({
      name: "Helen Marsh",
      email: "helen@lettings.test",
    });
    expect(parseAddress('"Marsh, Helen" <helen@lettings.test>')).toEqual({
      name: "Marsh, Helen",
      email: "helen@lettings.test",
    });
    expect(parseAddress("<a@b.example>")).toEqual({ email: "a@b.example" });
    expect(parseAddress("a@b.example")).toEqual({ email: "a@b.example" });
    expect(parseAddress("=?UTF-8?B?Q2Fmw6kgUm9zYQ==?= <rosa@cafe.example>")).toEqual({
      name: "Café Rosa",
      email: "rosa@cafe.example",
    });
  });

  it("splits lists on commas outside quotes", () => {
    expect(parseAddressList('"Marsh, Helen" <h@l.test>, sam@x.example')).toEqual([
      { name: "Marsh, Helen", email: "h@l.test" },
      { email: "sam@x.example" },
    ]);
  });

  it("formats names safely", () => {
    expect(formatAddress({ email: "a@b.example" })).toBe("a@b.example");
    expect(formatAddress({ name: "Dana Whitfield", email: "d@c.example" })).toBe(
      "Dana Whitfield <d@c.example>",
    );
    expect(formatAddress({ name: 'Smith, "J"', email: "j@s.example" })).toBe(
      '"Smith, \\"J\\"" <j@s.example>',
    );
    expect(formatAddress({ name: "Zoë", email: "z@o.example" })).toBe("=?UTF-8?B?Wm/Dqw==?= <z@o.example>");
  });

  it("refuses malformed addresses and header injection", () => {
    expect(() => formatAddress({ email: "not an address" })).toThrow(/doesn't look like an email address/);
    expect(() => formatAddress({ email: "a@b.example\r\nBcc: spy@evil.test" })).toThrow(/line breaks/);
    expect(() => formatAddress({ name: "X\nBcc: spy@evil.test", email: "a@b.example" })).toThrow(
      /line breaks/,
    );
  });
});

describe("messages", () => {
  it("builds a message that parses back to the same fields", () => {
    const raw = buildMessage({
      to: [{ name: "Helen Marsh", email: "helen@lettings.test" }],
      cc: [{ email: "office@lettings.test" }],
      subject: "Re: Boiler — Thursday 8:00 works",
      text: "Hello,\n\nThursday 8:00 to 10:00 works. Someone will be in.\n\n£ é 😀",
      inReplyTo: "<abc@lettings.test>",
      references: "<abc@lettings.test>",
    });
    expect(raw).toMatch(/\r\n/);
    expect(raw).toContain("Subject: =?UTF-8?B?");
    const parsed = parseMessage(raw);
    expect(headerValue(parsed.headers, "To")).toBe("Helen Marsh <helen@lettings.test>");
    expect(headerValue(parsed.headers, "Cc")).toBe("office@lettings.test");
    expect(headerValue(parsed.headers, "Subject")).toBe("Re: Boiler — Thursday 8:00 works");
    expect(headerValue(parsed.headers, "In-Reply-To")).toBe("<abc@lettings.test>");
    expect(parsed.text).toBe("Hello,\n\nThursday 8:00 to 10:00 works. Someone will be in.\n\n£ é 😀");
  });

  it("builds multipart/alternative when given HTML", () => {
    const parsed = parseMessage(
      buildMessage({ to: [{ email: "a@b.example" }], subject: "Hi", text: "Plain", html: "<p>Rich</p>" }),
    );
    expect(parsed.text).toBe("Plain");
    expect(parsed.html).toBe("<p>Rich</p>");
  });

  it("refuses a subject with a line break", () => {
    expect(() =>
      buildMessage({ to: [{ email: "a@b.example" }], subject: "Hi\r\nBcc: x@y.example", text: "" }),
    ).toThrow(/line breaks/);
  });

  it("reads quoted-printable and ISO-8859-1 parts", () => {
    const raw = [
      "From: a@b.example",
      "Subject: =?ISO-8859-1?Q?caf=E9?=",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=ISO-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Un caf=E9 =",
      "s'il vous pla=EEt",
      "--b1--",
      "",
    ].join("\r\n");
    const parsed = parseMessage(new Uint8Array(Buffer.from(raw, "latin1")));
    expect(headerValue(parsed.headers, "Subject")).toBe("café");
    expect(parsed.text).toBe("Un café s'il vous plaît");
  });

  it("round-trips base64url and decodes encoded words", () => {
    expect(base64UrlDecode(base64UrlEncode("£ and ü?/+"))).toBe("£ and ü?/+");
    expect(decodeWords("=?UTF-8?Q?Caf=C3=A9_Rosa?= =?UTF-8?Q?_is_open?=")).toBe("Café Rosa is open");
  });
});
