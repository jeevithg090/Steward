// Parsing adapted from openduet/openbot/scripts/fake-google/server.ts (MIT, CopilotKit)
import type { EmailAddress } from "@steward/shared";

/**
 * Just enough MIME for mail an agent reads and writes: RFC 2822 headers, RFC 2047 encoded words,
 * base64 and quoted-printable bodies, and multipart/alternative. Used by the Gmail client to build
 * what it sends and by the demo server to read what it receives.
 */

export interface Header {
  name: string;
  value: string;
}

export function base64UrlEncode(text: string | Uint8Array): string {
  return Buffer.from(typeof text === "string" ? new TextEncoder().encode(text) : text).toString("base64url");
}

export function base64UrlDecodeBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data.replace(/\+/g, "-").replace(/\//g, "_"), "base64url"));
}

export function base64UrlDecode(data: string, charset = "utf-8"): string {
  return decodeBytes(base64UrlDecodeBytes(data), charset);
}

export function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function headerValue(headers: readonly Header[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

/** Refuses CR, LF and NUL in anything headed for a header: that is how header injection starts. */
export function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n\0]/.test(value)) throw new Error(`The ${field} can't contain line breaks.`);
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value);
}

/** An RFC 2047 encoded word when the text is not plain ASCII; the text itself otherwise. */
export function encodeHeaderText(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  // Encoded words are capped at 75 characters, so long text becomes several, split on code points.
  const words: string[] = [];
  let chunk = "";
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** `"Name, Inc." <a@b.com>`, `=?UTF-8?B?...?= <a@b.com>` or `a@b.com`. Throws on a malformed address. */
export function formatAddress(address: EmailAddress): string {
  const email = address.email.trim();
  assertHeaderSafe(email, "email address");
  if (!isEmailAddress(email)) throw new Error(`"${email}" doesn't look like an email address.`);
  const name = address.name?.trim();
  if (!name) return email;
  assertHeaderSafe(name, "name");
  if (!/^[\x20-\x7e]*$/.test(name)) return `${encodeHeaderText(name)} <${email}>`;
  if (/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ .-]*$/.test(name) && !name.includes("..")) return `${name} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** Decodes RFC 2047 encoded words (`=?UTF-8?B?...?=`, `=?ISO-8859-1?Q?...?=`). */
export function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (whole, charset: string, encoding: string, text: string) => {
        try {
          const bytes =
            encoding.toUpperCase() === "B"
              ? Buffer.from(text, "base64")
              : Buffer.from(
                  text
                    .replace(/_/g, " ")
                    .replace(/=([0-9A-Fa-f]{2})/g, (_, code: string) =>
                      String.fromCharCode(Number.parseInt(code, 16)),
                    ),
                  "latin1",
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return whole;
        }
      },
    );
}

/** Splits an address header on commas outside quotes and angle brackets. */
export function splitAddresses(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") depth++;
    if (!quoted && char === ">") depth = Math.max(0, depth - 1);
    if (char === "," && !quoted && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

/** One address: `Name <a@b>`, `"Last, First" <a@b>`, `<a@b>` or `a@b`. */
export function parseAddress(value: string | undefined): EmailAddress | undefined {
  if (!value) return undefined;
  const text = decodeWords(value.trim());
  const angle = /^(.*?)<([^<>]+)>\s*$/.exec(text);
  if (angle) {
    const name = (angle[1] ?? "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\(.)/g, "$1")
      .trim();
    const email = (angle[2] ?? "").trim();
    return name ? { name, email } : { email };
  }
  const bare = text.replace(/\s*\(.*\)\s*$/, "").trim();
  return bare ? { email: bare } : undefined;
}

export function parseAddressList(value: string | undefined): EmailAddress[] {
  return splitAddresses(value)
    .map(parseAddress)
    .filter((a): a is EmailAddress => a !== undefined && a.email !== "");
}

export interface ParsedMessage {
  headers: Header[];
  text: string;
  html?: string;
}

/** Parses a raw RFC 2822 message, keeping the first text/plain and text/html parts. */
export function parseMessage(raw: string | Uint8Array): ParsedMessage {
  const binary = (typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw)).toString("latin1");
  const entity = parseEntity(binary);
  return {
    headers: entity.headers.map((h) => ({ name: h.name, value: decodeWords(h.value) })),
    text: entity.text,
    html: entity.html,
  };
}

function parseEntity(binary: string): { headers: Header[]; text: string; html?: string } {
  const split = /\r?\n\r?\n/.exec(binary);
  const head = split ? binary.slice(0, split.index) : binary;
  const rest = split ? binary.slice(split.index + split[0].length) : "";
  const headers = head
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)
    .filter((line) => line.includes(":"))
    .map((line) => {
      const colon = line.indexOf(":");
      return { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    });

  const type = headerValue(headers, "Content-Type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    let text = "";
    let html: string | undefined;
    for (const part of rest.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const inner = parseEntity(part.replace(/^\r?\n/, ""));
      const innerType = headerValue(inner.headers, "Content-Type") ?? "text/plain";
      if (/^multipart\//i.test(innerType)) {
        text ||= inner.text;
        html ??= inner.html;
      } else if (/^text\/html/i.test(innerType)) {
        html ??= inner.html ?? inner.text;
      } else if (/^text\/plain/i.test(innerType) && !text) {
        text = inner.text;
      }
    }
    return { headers, text, html };
  }

  const encoding = (headerValue(headers, "Content-Transfer-Encoding") ?? "7bit").toLowerCase();
  const bytes =
    encoding === "base64"
      ? Buffer.from(rest.replace(/\s+/g, ""), "base64")
      : encoding === "quoted-printable"
        ? Buffer.from(
            rest
              .replace(/=\r?\n/g, "")
              .replace(/=([0-9A-Fa-f]{2})/g, (_, code: string) =>
                String.fromCharCode(Number.parseInt(code, 16)),
              ),
            "latin1",
          )
        : Buffer.from(rest, "latin1");
  const charset = /charset="?([^";\s]+)"?/i.exec(type)?.[1] ?? "utf-8";
  const body = decodeBytes(new Uint8Array(bytes), charset).replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (/^text\/html/i.test(type)) return { headers, text: "", html: body };
  return { headers, text: body };
}

export interface OutgoingMessage {
  from?: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  text: string;
  html?: string;
  date?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  /** Extra headers, written as given after checking for line breaks. */
  headers?: Header[];
}

/**
 * Builds an RFC 2822 message with CRLF line endings. Plain text only unless `html` is given, in
 * which case it is multipart/alternative. Bodies go as base64 so any character survives any relay.
 */
export function buildMessage(msg: OutgoingMessage): string {
  assertHeaderSafe(msg.subject, "subject");
  const lines: string[] = [];
  const add = (name: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    assertHeaderSafe(value.replace(/\r\n /g, " "), name);
    lines.push(`${name}: ${value}`);
  };
  add("From", msg.from ? formatAddress(msg.from) : undefined);
  add("To", msg.to.map(formatAddress).join(", "));
  add("Cc", msg.cc?.map(formatAddress).join(", "));
  add("Bcc", msg.bcc?.map(formatAddress).join(", "));
  lines.push(`Subject: ${encodeHeaderText(msg.subject)}`);
  add("Date", msg.date);
  add("Message-ID", msg.messageId);
  add("In-Reply-To", msg.inReplyTo);
  add("References", msg.references);
  for (const h of msg.headers ?? []) {
    assertHeaderSafe(h.name, "header name");
    add(h.name, h.value);
  }
  lines.push("MIME-Version: 1.0");

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap64(msg.text),
  ];
  if (msg.html === undefined) {
    lines.push(...textPart);
  } else {
    const boundary = `steward-${Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("hex")}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`, ...textPart);
    lines.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrap64(msg.html),
    );
    lines.push(`--${boundary}--`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function wrap64(text: string): string {
  return (
    Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\r\n");
}
