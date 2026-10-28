/**
 * Apple property lists as XML, both ways, with no dependency. `shortcuts sign` reads XML as well as
 * binary plists (docs/research/shortcuts.md §1.1), and a crash in Apple's migrator on bad input is
 * why every file is parsed back before it is signed.
 */

export type PlistValue = string | number | boolean | Date | Uint8Array | PlistValue[] | PlistDict;
export interface PlistDict {
  [key: string]: PlistValue;
}

/** Characters XML 1.0 cannot carry: controls other than tab and newlines, and U+FFFE, U+FFFF. */
function hasInvalidXmlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) return true;
  }
  return false;
}

function escapeXml(text: string): string {
  if (hasInvalidXmlChar(text)) throw new Error("A plist string held a character XML cannot carry.");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function write(value: PlistValue, indent: string, out: string[]): void {
  const next = `${indent}\t`;
  if (typeof value === "string") {
    out.push(`${indent}<string>${escapeXml(value)}</string>`);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A plist number must be finite.");
    out.push(
      Number.isInteger(value) ? `${indent}<integer>${value}</integer>` : `${indent}<real>${value}</real>`,
    );
  } else if (typeof value === "boolean") {
    out.push(`${indent}<${value}/>`);
  } else if (value instanceof Date) {
    out.push(`${indent}<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`);
  } else if (value instanceof Uint8Array) {
    out.push(`${indent}<data>${base64(value)}</data>`);
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${indent}<array/>`);
      return;
    }
    out.push(`${indent}<array>`);
    for (const item of value) write(item, next, out);
    out.push(`${indent}</array>`);
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push(`${indent}<dict/>`);
      return;
    }
    out.push(`${indent}<dict>`);
    for (const key of keys) {
      const item = value[key];
      if (item === undefined) continue;
      out.push(`${next}<key>${escapeXml(key)}</key>`);
      write(item, next, out);
    }
    out.push(`${indent}</dict>`);
  } else {
    throw new Error(`A plist cannot hold ${value === null ? "null" : typeof value}.`);
  }
}

/** Writes a value as an XML plist document. Undefined dictionary values are left out. */
export function toXmlPlist(value: PlistValue): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
  ];
  write(value, "", out);
  out.push("</plist>", "");
  return out.join("\n");
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────

export class PlistError extends Error {
  override name = "PlistError";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    const known = ENTITIES[name];
    if (known === undefined) throw new PlistError(`Unknown XML entity ${whole}.`);
    return known;
  });
}

type Tag = { kind: "open" | "close" | "empty"; name: string } | { kind: "text"; text: string };

function* tokens(xml: string): Generator<Tag> {
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (xml.slice(i).trim()) yield { kind: "text", text: xml.slice(i) };
      return;
    }
    if (lt > i) yield { kind: "text", text: xml.slice(i, lt) };
    if (xml.startsWith("<?", lt)) {
      i = xml.indexOf("?>", lt) + 2;
    } else if (xml.startsWith("<!--", lt)) {
      i = xml.indexOf("-->", lt) + 3;
    } else if (xml.startsWith("<!", lt)) {
      i = xml.indexOf(">", lt) + 1;
    } else {
      const gt = xml.indexOf(">", lt);
      if (gt === -1) throw new PlistError("An XML tag was never closed.");
      const raw = xml.slice(lt + 1, gt).trim();
      if (raw.startsWith("/")) yield { kind: "close", name: raw.slice(1).trim() };
      else if (raw.endsWith("/")) yield { kind: "empty", name: raw.slice(0, -1).trim().split(/\s/)[0]! };
      else yield { kind: "open", name: raw.split(/\s/)[0]! };
      i = gt + 1;
    }
    if (i <= lt) throw new PlistError("The XML could not be read.");
  }
}

/** Parses an XML plist document back into values. Throws `PlistError` on anything malformed. */
export function parsePlist(xml: string): PlistValue {
  const stream = [...tokens(xml)];
  let pos = 0;

  const peek = (): Tag | undefined => {
    while (pos < stream.length) {
      const t = stream[pos]!;
      if (t.kind === "text" && t.text.trim() === "") {
        pos++;
        continue;
      }
      return t;
    }
    return undefined;
  };
  const take = (): Tag => {
    const t = peek();
    if (!t) throw new PlistError("The plist ended too early.");
    pos++;
    return t;
  };
  const textUntil = (name: string): string => {
    let text = "";
    while (pos < stream.length) {
      const t = stream[pos++]!;
      if (t.kind === "text") text += t.text;
      else if (t.kind === "close" && t.name === name) return unescapeXml(text);
      else throw new PlistError(`<${name}> holds something other than text.`);
    }
    throw new PlistError(`<${name}> was never closed.`);
  };

  const value = (): PlistValue => {
    const t = take();
    if (t.kind === "empty") {
      switch (t.name) {
        case "true":
          return true;
        case "false":
          return false;
        case "string":
          return "";
        case "array":
          return [];
        case "dict":
          return {};
        case "data":
          return new Uint8Array();
        default:
          throw new PlistError(`<${t.name}/> is not a plist value.`);
      }
    }
    if (t.kind !== "open") throw new PlistError("Expected a plist value.");
    switch (t.name) {
      case "string":
        return textUntil("string");
      case "integer": {
        const n = Number(textUntil("integer").trim());
        if (!Number.isInteger(n)) throw new PlistError("An <integer> is not a whole number.");
        return n;
      }
      case "real": {
        const n = Number(textUntil("real").trim());
        if (!Number.isFinite(n)) throw new PlistError("A <real> is not a number.");
        return n;
      }
      case "date": {
        const d = new Date(textUntil("date").trim());
        if (Number.isNaN(d.getTime())) throw new PlistError("A <date> could not be read.");
        return d;
      }
      case "data":
        return Uint8Array.from(atob(textUntil("data").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      case "array": {
        const items: PlistValue[] = [];
        for (;;) {
          const n = peek();
          if (n?.kind === "close" && n.name === "array") {
            pos++;
            return items;
          }
          items.push(value());
        }
      }
      case "dict": {
        const dict: PlistDict = {};
        for (;;) {
          const n = take();
          if (n.kind === "close" && n.name === "dict") return dict;
          if (n.kind !== "open" || n.name !== "key")
            throw new PlistError("A <dict> holds a value without a <key>.");
          const key = textUntil("key");
          if (Object.hasOwn(dict, key)) throw new PlistError(`The key "${key}" appears twice.`);
          dict[key] = value();
        }
      }
      default:
        throw new PlistError(`<${t.name}> is not a plist value.`);
    }
  };

  const open = take();
  if (open.kind !== "open" || open.name !== "plist") throw new PlistError("This is not a plist.");
  const root = value();
  const close = take();
  if (close.kind !== "close" || close.name !== "plist")
    throw new PlistError("The plist holds more than one value.");
  if (peek()) throw new PlistError("There is text after the plist.");
  return root;
}
