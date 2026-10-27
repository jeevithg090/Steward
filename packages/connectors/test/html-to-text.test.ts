import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "../src/web/html-to-text.ts";

const PAGE = `<!doctype html>
<html lang="en"><head>
  <title>Kestrel &amp; Co &mdash; News</title>
  <meta property="og:title" content="Ignored when a title exists">
  <style>.hero{color:red}</style>
  <script>window.track("visit <b>bold</b>")</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About us</a></nav>
  <main>
    <h1>Big   news</h1>
    <p>We have <b>moved</b> to a <a href="/new-office">new office</a>. It&#39;s &pound;5 &#x2014; see
       <a href="https://maps.example.com/x">https://maps.example.com/x</a>.</p>
    <h2>What changes</h2>
    <ul><li><div>Opening hours</div></li><li><p>Parking</p><ol><li>Bay A</li><li>Bay B</li></ol></li><li></li></ul>
    <table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>£2</td></tr></table>
    <pre>  keep
    this spacing</pre>
    <p>Line one<br>line two</p>
    <a href="/home"><img alt="Kestrel logo" src="logo.png"></a>
    <a href="javascript:void(0)">Do a thing</a>
    <noscript>Please enable JavaScript</noscript>
  </main>
</body></html>`;

describe("htmlToText", () => {
  const { title, text } = htmlToText(PAGE, { baseUrl: "https://kestrel.example/blog/post" });

  it("takes the title from <title>, decoding entities", () => {
    expect(title).toBe("Kestrel & Co — News");
  });

  it("drops scripts, styles, noscript, navigation and the head", () => {
    expect(text).not.toMatch(/track|color:red|enable JavaScript|About us|Ignored/);
  });

  it("marks headings and keeps links as markdown with absolute URLs", () => {
    expect(text).toContain("# Big news");
    expect(text).toContain("## What changes");
    expect(text).toContain("[new office](https://kestrel.example/new-office)");
    // A link whose text is its own address is written once.
    expect(text).toContain("see https://maps.example.com/x.");
    expect(text).toContain("[Kestrel logo](https://kestrel.example/home)");
    expect(text).toContain("Do a thing");
    expect(text).not.toContain("javascript:");
  });

  it("writes lists, nested lists and tables readably, and drops empty items", () => {
    expect(text).toContain("- Opening hours\n- Parking\n  1. Bay A\n  2. Bay B");
    expect(text).not.toMatch(/^\s*-\s*$/m);
    expect(text).toContain("Item | Price\nTea | £2");
  });

  it("keeps preformatted text and line breaks", () => {
    expect(text).toContain("  keep\n    this spacing");
    expect(text).toContain("Line one\nline two");
  });

  it("collapses whitespace and decodes entities", () => {
    expect(text).toContain("It's £5 — see");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("falls back to og:title, then the first heading", () => {
    expect(htmlToText('<meta property="og:title" content="From OG"><p>x</p>').title).toBe("From OG");
    expect(htmlToText("<h2>Only a heading</h2><p>Body</p>").title).toBe("Only a heading");
  });

  it("takes og:title only from a real meta tag, apostrophes and all", () => {
    expect(htmlToText(`<meta property="og:title" content="Rock 'n' roll"><p>x</p>`).title).toBe(
      "Rock 'n' roll",
    );
    expect(htmlToText('<!-- <meta property="og:title" content="Old"> --><h1>New</h1>').title).toBe("New");
  });

  it("ends the head at <body> when </head> was left out", () => {
    expect(htmlToText("<html><head><title>T</title><body><p>Visible</p>").text).toBe("Visible");
  });

  it("can leave links out", () => {
    expect(htmlToText('<p>See <a href="https://a.example/">this</a></p>', { links: false }).text).toBe(
      "See this",
    );
  });
});

describe("htmlToText output", () => {
  // Pinned to what the converter wrote before it was made linear: speed must not change the text.
  it("writes the sample page exactly as before", () => {
    expect(htmlToText(PAGE, { baseUrl: "https://kestrel.example/blog/post" }).text).toBe(
      "# Big news\n\nWe have moved to a [new office](https://kestrel.example/new-office). It's £5 — see " +
        "https://maps.example.com/x.\n\n## What changes\n\n- Opening hours\n- Parking\n  1. Bay A\n  2. Bay B" +
        "\n\nItem | Price\nTea | £2\n\n  keep\n    this spacing\n\nLine one\nline two\n\n" +
        "[Kestrel logo](https://kestrel.example/home) Do a thing",
    );
  });

  it.each([
    [
      '<p>Read <a href="/a">the <b>whole</b>\n story</a> and <a href="/b"><a href="/c">nested</a> outer</a> then <a href="/d">open',
      "Read [the whole story](https://site.example/a) and [[nested](https://site.example/c) outer](https://site.example/b) then open",
    ],
    ['<span>Foo</span> <a href="/x"><div>Card</div></a> after', "Foo\n[Card](https://site.example/x) after"],
    ['<ul><li><a href="/x"></li><li>Item</li></ul>', "- Item"],
    ["<pre>\t- </pre><p>x</p><h2></h2><ol><li></li><li>2</li></ol>", "- x\n\n2. 2"],
    [
      '<a title="x>y" href="/q">quoted</a> <b class="a\'b">it\'s</b> <a "unclosed',
      "[quoted](https://site.example/q) it's <a \"unclosed",
    ],
    ["<td>a</td><td>b</td>\n<tr><td>c</td></tr>", "a | b\nc"],
    ["<!-- <p>gone</p> --><p>kept</p><!-- open <p>still here</p>", "kept\n\nstill here"],
  ])("writes %j as before", (html, expected) => {
    expect(htmlToText(html, { baseUrl: "https://site.example/dir/" }).text).toBe(expected);
  });
});

describe("htmlToText on large and broken input", () => {
  const MB = 1024 * 1024;
  const fill = (unit: string, chars: number) => unit.repeat(Math.ceil(chars / unit.length));
  /** Converts and times it: every step that rescanned the text or the input made pages like these take minutes. */
  const timed = (html: string, opts?: Parameters<typeof htmlToText>[1]) => {
    const start = performance.now();
    const result = htmlToText(html, opts);
    return { ...result, ms: performance.now() - start };
  };

  it("converts 2 MB of short paragraphs in well under a second", () => {
    const { text, ms } = timed(fill("<p>a</p>", 2 * MB));
    expect(text.startsWith("a\n\na\n\na")).toBe(true);
    expect(text).toHaveLength(3 * Math.ceil((2 * MB) / 8) - 2);
    expect(ms).toBeLessThan(1000);
  });

  it("converts a 340 KB article in well under a second", () => {
    const section = (i: number) =>
      `<h2>Part ${i}</h2><p>Councillors met on Tuesday to discuss the plans, which are set out in <a href="/archive/${i}">the archive</a> and were <b>first</b> published in spring.</p>` +
      `<ul><li>Budget</li><li>Timeline, with <a href="https://other.example/t">a chart</a></li></ul><table><tr><td>Cost</td><td>£${i}</td></tr></table>\n`;
    let article = "<html><head><title>Plans</title></head><body><article>";
    for (let i = 0; article.length < 340 * 1024; i++) article += section(i);
    const { text, ms } = timed(`${article}</article></body></html>`, { baseUrl: "https://news.example/" });
    expect(text).toContain(
      "discuss the plans, which are set out in [the archive](https://news.example/archive/7)",
    );
    expect(text).toContain("- Timeline, with [a chart](https://other.example/t)\n\nCost | £7\n\n## Part 8");
    expect(ms).toBeLessThan(1000);
  });

  it.each([
    ["tags that never close", fill("<a ", MB)],
    ["quotes that never close", fill('<a "', MB)],
    ["one tag name that never ends", `<${"a".repeat(MB)}`],
    ["comments that never close", fill("<!--", MB)],
    ["scripts that never close", fill("<script>", MB)],
    ["titles that never close", fill("<title>", MB)],
    ["a title full of unclosed tags", `<title>${fill("<", MB)}</title>`],
    ["meta tags that never close", fill("<meta property=og:title ", MB)],
    ["declarations that never close", fill("<!", MB)],
    ["links nested deep", `${fill('<a href="https://x.example/">', MB)}x${fill("</a>", MB / 4)}`],
    ["links that each span a line break", fill('word <a href="/q">a<br>b</a> ', MB)],
    ["links around blocks", fill('<span>Foo</span> <a href="/x"><div>Card</div></a>', MB)],
    ["lists nested deep", `${fill("<ul>", MB)}${fill("<li>x", MB / 4)}`],
    ["empty list items", fill("x<li></li>", MB)],
    ["empty headings", fill("x<h2></h2>", MB)],
    ["empty table cells and rows", fill("x<td></td><tr>", MB)],
    ["preformatted tabs between blocks", `<pre>${fill("x\t<div>", MB)}`],
    ["preformatted spaces before a bar", `<pre>x${fill(" ", MB)}|y</pre>`],
  ])("stays fast on %s", (_, html) => {
    expect(timed(html, { baseUrl: "https://site.example/" }).ms).toBeLessThan(1000);
  });

  it("stops soon after maxChars, cuts the text to it and says so", () => {
    const html = fill("<p>Some words, then <a href='/x'>a link</a>.</p>", 2 * MB);
    const full = htmlToText(html, { baseUrl: "https://site.example/" });
    const cut = htmlToText(html, { baseUrl: "https://site.example/", maxChars: 1000 });
    expect(cut.text).toBe(full.text.slice(0, 1000));
    expect(cut).toMatchObject({ title: full.title, truncated: true });
    expect(full.truncated).toBe(false);
    expect(htmlToText("<p>short</p>", { maxChars: 1000 })).toEqual({
      title: "",
      text: "short",
      truncated: false,
    });
    // It stopped reading: text after a long run of line breaks is never reached.
    expect(htmlToText(`${"<br>".repeat(10_000)}<p>Later</p>`, { maxChars: 100 })).toMatchObject({
      text: "",
      truncated: true,
    });
    // A surrogate pair is never split.
    expect(htmlToText(`<p>${"a".repeat(9)}😀</p>`, { maxChars: 10 }).text).toBe("a".repeat(9));
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex references and leaves unknown ones", () => {
    expect(decodeEntities("&lt;b&gt; &amp; &quot;q&quot; &#39;s&#39; &#x1F600; &nbsp;x &bogus; AT&T")).toBe(
      "<b> & \"q\" 's' 😀  x &bogus; AT&T",
    );
  });

  it("replaces invalid code points rather than throwing", () => {
    expect(decodeEntities("&#xD800;&#0;&#1114112;")).toBe("���");
  });
});
