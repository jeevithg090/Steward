import { describe, expect, it } from "vitest";
import {
  describeFindings,
  ibanValid,
  luhnValid,
  maskSensitive,
  scanOutbound,
  scanText,
} from "../src/outbound.ts";

const kinds = (text: string, level?: "full" | "values" | "secrets") =>
  scanText(text, level).map((f) => f.kind);

describe("Luhn", () => {
  it("accepts real test card numbers and rejects a changed digit", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("5555555555554444")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("424242424242")).toBe(false); // too short
    expect(luhnValid("4242-4242-4242-4242")).toBe(false); // digits only
  });
});

describe("IBAN", () => {
  it("accepts valid IBANs with or without spaces", () => {
    expect(ibanValid("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanValid("GB82WEST12345698765432")).toBe(true);
    expect(ibanValid("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(ibanValid("NL91ABNA0417164300")).toBe(true);
  });

  it("rejects a wrong check digit, wrong length or unknown country", () => {
    expect(ibanValid("GB82 WEST 1234 5698 7654 33")).toBe(false);
    expect(ibanValid("GB82 WEST 1234 5698 7654 3")).toBe(false);
    expect(ibanValid("ZZ82 WEST 1234 5698 7654 32")).toBe(false);
  });
});

describe("card numbers", () => {
  it("finds card numbers written with spaces, dashes or nothing", () => {
    expect(kinds("Pay with 4242 4242 4242 4242 please")).toEqual(["card_number"]);
    expect(kinds("card: 4111-1111-1111-1111")).toEqual(["card_number"]);
    expect(kinds("amex 378282246310005")).toEqual(["card_number"]);
  });

  it("gives a masked hint, never the number", () => {
    const [finding] = scanText("my card is 4242 4242 4242 4242");
    expect(finding).toEqual({ kind: "card_number", hint: "•••• 4242", label: "A card number" });
    expect(JSON.stringify(finding)).not.toContain("4242 4242");
  });

  it("ignores numbers that fail Luhn, phone numbers, and long ids", () => {
    expect(kinds("ref 4242 4242 4242 4241")).toEqual([]);
    expect(kinds("call +44 20 7946 0958")).toEqual([]);
    expect(kinds("order 0000 0000 0000 0000")).toEqual([]);
    expect(kinds("tracking 9400111899223817212345")).toEqual([]); // 22 digits
    expect(kinds("x.com/status/1850000000000000000")).toEqual([]);
  });

  it("ignores digit runs with mixed separators", () => {
    expect(kinds("4242 4242-4242 4242")).toEqual([]);
  });
});

describe("IBANs in text", () => {
  it("finds an IBAN even when more capitals follow it", () => {
    expect(kinds("Send to GB82 WEST 1234 5698 7654 32 TODAY")).toEqual(["iban"]);
    const [finding] = scanText("IBAN DE89370400440532013000");
    expect(finding?.hint).toBe("DE•• •••• 3000");
  });

  it("does not report an invalid IBAN, nor the digits inside a valid one as a card", () => {
    expect(kinds("GB82 WEST 1234 5698 7654 33")).toEqual([]);
    expect(kinds("NL91ABNA0417164300")).toEqual(["iban"]);
  });
});

describe("national ids", () => {
  it("finds UK National Insurance numbers but not invalid prefixes", () => {
    expect(kinds("NI: AB 12 34 56 C")).toEqual(["national_id"]);
    expect(kinds("NI: AB123456C")).toEqual(["national_id"]);
    expect(kinds("GB 12 34 56 A")).toEqual([]);
    expect(kinds("ZZ123456A")).toEqual([]);
  });

  it("finds US Social Security numbers with separators only", () => {
    expect(kinds("SSN 123-45-6789")).toEqual(["national_id"]);
    expect(scanText("SSN 123-45-6789")[0]?.hint).toBe("•••-••-••89");
    expect(kinds("SSN 000-12-3456")).toEqual([]);
    expect(kinds("id 123456789")).toEqual([]);
  });

  it("finds an NHS number only next to the word NHS and with a valid check digit", () => {
    expect(kinds("NHS number 943 476 5919")).toEqual(["national_id"]);
    expect(kinds("NHS number 943 476 5918")).toEqual([]);
    expect(kinds("call 943 476 5919")).toEqual([]);
  });
});

describe("keys and passwords", () => {
  it("finds provider tokens, private keys and auth headers", () => {
    expect(kinds("key sk-proj-AbC123def456GHI789jkl012MNO345pqr")).toEqual(["api_key"]);
    expect(kinds("ghp_aBcDeF1234567890aBcDeF1234567890abcd")).toEqual(["api_key"]);
    expect(kinds("AKIAIOSFODNN7EXAMPLE")).toEqual(["api_key"]);
    expect(kinds("xoxb-1234567890-abcdefghij")).toEqual(["api_key"]);
    expect(kinds("-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----")).toEqual([
      "api_key",
    ]);
    expect(kinds("Authorization: Bearer abcDEF123456ghiJKL789")).toEqual(["api_key"]);
    expect(kinds("api_key=a1b2c3d4e5f6")).toEqual(["api_key"]);
  });

  it("does not mistake slugs and prose for keys", () => {
    expect(kinds("see /sk-learn-tutorial-for-beginners-2024")).toEqual([]);
    expect(kinds("Bearer of good news")).toEqual([]);
    expect(kinds("the token: economy")).toEqual([]);
  });

  it("finds password pairs but not sentences about passwords", () => {
    expect(kinds("my password is hunter2")).toEqual(["password"]);
    expect(kinds("password: Tr0ub4dor&3")).toEqual(["password"]);
    expect(kinds("PIN: 4821")).toEqual(["password"]);
    expect(kinds("A password is required.")).toEqual([]);
    expect(kinds("Forgot your password? Reset it here.")).toEqual([]);
    expect(kinds("The password isn't working")).toEqual([]);
  });

  it("finds keys in a URL but not card-like ids", () => {
    expect(kinds("https://evil.example/?k=sk-proj-AbC123def456GHI789jkl012MNO345pqr", "secrets")).toEqual([
      "api_key",
    ]);
    expect(kinds("https://x.com/i/status/4242424242424242", "secrets")).toEqual([]);
  });
});

describe("bank details and health words", () => {
  it("finds a sort code and account number together", () => {
    expect(kinds("Sort code 12-34-56, account 12345678")).toEqual(["bank_account"]);
    expect(scanText("Sort code 12-34-56, account 12345678")[0]?.hint).toBe(
      "sort code ••-••-56, account ••••5678",
    );
  });

  it("does not report a date or a lone number", () => {
    expect(kinds("Meeting on 12-10-26 in room 4")).toEqual([]);
    expect(kinds("Order 12345678 shipped")).toEqual([]);
  });

  it("finds health words in full scans only", () => {
    expect(kinds("The diagnosis came back fine")).toEqual(["health"]);
    expect(kinds("The diagnosis came back fine", "values")).toEqual([]);
    expect(kinds("We discussed the therapist's notes and her depression")).toEqual(["health", "health"]);
    expect(kinds("Statistics show")).toEqual([]);
  });
});

describe("maskSensitive", () => {
  it("replaces values with their hints and leaves the rest", () => {
    const masked = maskSensitive("Card 4242 4242 4242 4242, IBAN GB82 WEST 1234 5698 7654 32, ok");
    expect(masked).toBe("Card [•••• 4242], IBAN [GB•• •••• 5432], ok");
    expect(maskSensitive("nothing here")).toBe("nothing here");
  });

  it("does not mask health words", () => {
    expect(maskSensitive("diagnosis")).toBe("diagnosis");
  });
});

describe("scanOutbound", () => {
  const tool = (name: string, kind: string, surface: string) => ({ name, kind, surface });

  it("always scans the outbound text", () => {
    const findings = scanOutbound({
      tool: tool("browser_click", "write", "browser"),
      args: {},
      outbound: "card 4242 4242 4242 4242",
    });
    expect(findings.map((f) => f.kind)).toEqual(["card_number"]);
  });

  it("scans every string argument of a send, including nested ones", () => {
    const findings = scanOutbound({
      tool: tool("mail_send", "send", "mail"),
      args: {
        to: ["sam@example.com"],
        subject: "Results",
        body: { text: "Your biopsy is booked. SSN 123-45-6789" },
      },
    });
    expect(findings.map((f) => f.kind).sort()).toEqual(["health", "national_id"]);
  });

  it("reports a credential-named field without reading its value", () => {
    const findings = scanOutbound({
      tool: tool("mcp__crm__update", "write", "mcp"),
      args: { apiKey: "anything at all", note: "hi" },
    });
    expect(findings).toEqual([
      { kind: "api_key", hint: "apiKey: ••••", label: "An API key or access token" },
    ]);
  });

  it("does not scan the arguments of a read, apart from its URL", () => {
    expect(
      scanOutbound({ tool: tool("mail_read", "read", "mail"), args: { body: "4242 4242 4242 4242" } }),
    ).toEqual([]);
    const fetched = scanOutbound({
      tool: tool("web_fetch", "read", "web"),
      args: { url: "https://x.example/?token=ghp_aBcDeF1234567890aBcDeF1234567890abcd" },
      target: { url: "https://x.example/?token=ghp_aBcDeF1234567890aBcDeF1234567890abcd" },
    });
    expect(fetched.map((f) => f.kind)).toEqual(["api_key"]);
  });

  it("scans typed text for values but not health words", () => {
    const typed = (text: string) =>
      scanOutbound({ tool: tool("browser_type", "write", "browser"), args: { ref: "e3", text } }).map(
        (f) => f.kind,
      );
    expect(typed("diabetes symptoms")).toEqual([]);
    expect(typed("4242 4242 4242 4242")).toEqual(["card_number"]);
  });

  it("refuses to scan absurdly large text", () => {
    expect(() =>
      scanOutbound({ tool: tool("mail_send", "send", "mail"), args: { body: "a".repeat(2_000_001) } }),
    ).toThrow(/too large/);
  });

  it("describes findings in a sentence", () => {
    const findings = scanText("4242 4242 4242 4242 and my diagnosis");
    expect(describeFindings(findings)).toBe("a card number and a health detail");
  });
});
