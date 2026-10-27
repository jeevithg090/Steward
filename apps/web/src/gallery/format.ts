/** Small formatting helpers shared by the cards and the chat's tool lines. */

/** `https://www.news.ycombinator.com/item?id=1` as `news.ycombinator.com`. */
export function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string" || url.trim() === "") return undefined;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.host.replace(/^www\./, "") || undefined;
  } catch {
    const text = url.trim();
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }
}

/** Recipients as a model or an API writes them: a string, a list of strings, or `{ name?, email }` objects. */
export function recipientsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      for (const part of entry.split(/[,;]/)) {
        const trimmed = part.trim();
        if (trimmed) out.push(trimmed);
      }
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const email = typeof record.email === "string" ? record.email.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (name && email) out.push(`${name} <${email}>`);
      else if (email || name) out.push(email || name);
    }
  }
  return out;
}

/** "Thu 22 Oct, 07:10", in the person's own locale and time zone. */
export function formatWhen(iso: unknown): string | undefined {
  if (typeof iso !== "string") return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Only http and https links are drawn as links; anything else is shown as text. */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
