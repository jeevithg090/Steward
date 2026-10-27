/**
 * Markdown as it should sound. Read aloud, `**Done**` is "Done", a link is its words, a code block
 * is mentioned rather than spelled out, and a bare URL is its site's name.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/g;

function siteOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "a link";
  }
}

export function speechText(markdown: string): string {
  return (
    markdown
      // Fenced code: say that there is some, not what it is.
      .replace(/```[\s\S]*?(```|$)/g, " (There's some code on screen.) ")
      // Images: their alt text, if any.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? ` ${alt} ` : " "))
      // Links: their words.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(URL_PATTERN, (url) => siteOf(url))
      // Inline code, emphasis, strike-through.
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      // Headings, quotes, list markers and table rules at the start of a line.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, "")
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "")
      .replace(/\|/g, ", ")
      // Every line break is a pause: a heading, a list item and a paragraph each end a sentence.
      .replace(/([^.!?:;,\s])[ \t]*\n+/g, "$1. ")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/([.!?])\s*\./g, "$1")
      .trim()
  );
}

/**
 * Splits text into pieces short enough to speak in one go. Some browsers stop an utterance after
 * about fifteen seconds, so long replies are queued as sentences of at most `max` characters.
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > max) {
      if (current) chunks.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += max) chunks.push(sentence.slice(i, i + max));
      continue;
    }
    if (current && current.length + sentence.length + 1 > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
