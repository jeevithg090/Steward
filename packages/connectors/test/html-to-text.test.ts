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
  const ms = (html: string, opts?: Parameters<typeof htmlToText>[1]) => {
    const start = performance.now();
    htmlToText(html, opts);
    return performance.now() - start;
  };

  /**
   * Every step that rescanned the text or the input made pages like these take minutes. A clock
   * limit cannot tell that from a busy machine, so this compares how the time grows instead: eight
   * times the input must take under 24 times as long. A rescan (quadratic) gives about 64, and one
   * pass about 8 on its own and up to twice that on a loaded machine. Each size keeps its fastest
   * run, the least the machine let it take, trying again up to five times for 10 s while the
   * growth looks wrong. Under 50 ms for the full size is too fast to be quadratic at all.
   */
  const expectLinear = (
    make: (chars: number) => string,
    size: number,
    opts?: Parameters<typeof htmlToText>[1],
  ) => {
    const small = make(size / 8);
    const large = make(size);
    htmlToText(small, opts);
    let fastestSmall = Number.POSITIVE_INFINITY;
    let fastestLarge = Number.POSITIVE_INFINITY;
    const linear = () => fastestLarge < 50 || fastestLarge / Math.max(fastestSmall, 1) < 24;
    const until = performance.now() + 10_000;
    for (let run = 0; run < 5 && (run === 0 || (!linear() && performance.now() < until)); run++) {
      fastestSmall = Math.min(fastestSmall, ms(small, opts));
      fastestLarge = Math.min(fastestLarge, ms(large, opts));
    }
    const growth = `${fastestSmall.toFixed(1)} ms for ${small.length} characters, ${fastestLarge.toFixed(1)} ms for ${large.length}`;
    expect(linear(), `the time grew faster than the input: ${growth}`).toBe(true);
    // A single pass that is merely slow is still a bug, but only a gross one is the clock's to catch.
    expect(fastestLarge, growth).toBeLessThan(10_000);
  };

  it("converts 2 MB of short paragraphs in one pass", () => {
    const paragraphs = (chars: number) => fill("<p>a</p>", chars);
    const text = htmlToText(paragraphs(2 * MB)).text;
    expect(text.startsWith("a\n\na\n\na")).toBe(true);
    expect(text).toHaveLength(3 * Math.ceil((2 * MB) / 8) - 2);
    expectLinear(paragraphs, 2 * MB);
  });

  it("converts a 340 KB article in one pass", () => {
    const section = (i: number) =>
      `<h2>Part ${i}</h2><p>Councillors met on Tuesday to discuss the plans, which are set out in <a href="/archive/${i}">the archive</a> and were <b>first</b> published in spring.</p>` +
      `<ul><li>Budget</li><li>Timeline, with <a href="https://other.example/t">a chart</a></li></ul><table><tr><td>Cost</td><td>£${i}</td></tr></table>\n`;
    const article = (chars: number) => {
      let html = "<html><head><title>Plans</title></head><body><article>";
      for (let i = 0; html.length < chars; i++) html += section(i);
      return `${html}</article></body></html>`;
    };
    const opts = { baseUrl: "https://news.example/" };
    const { text } = htmlToText(article(340 * 1024), opts);
    expect(text).toContain(
      "discuss the plans, which are set out in [the archive](https://news.example/archive/7)",
    );
    expect(text).toContain("- Timeline, with [a chart](https://other.example/t)\n\nCost | £7\n\n## Part 8");
    expectLinear(article, 340 * 1024, opts);
  });

  it.each<[string, (chars: number) => string]>([
    ["tags that never close", (n) => fill("<a ", n)],
    ["quotes that never close", (n) => fill('<a "', n)],
    ["one tag name that never ends", (n) => `<${"a".repeat(n)}`],
    ["comments that never close", (n) => fill("<!--", n)],
    ["scripts that never close", (n) => fill("<script>", n)],
    ["titles that never close", (n) => fill("<title>", n)],
    ["a title full of unclosed tags", (n) => `<title>${fill("<", n)}</title>`],
    ["meta tags that never close", (n) => fill("<meta property=og:title ", n)],
    ["declarations that never close", (n) => fill("<!", n)],
    ["links nested deep", (n) => `${fill('<a href="https://x.example/">', n)}x${fill("</a>", n / 4)}`],
    ["links that each span a line break", (n) => fill('word <a href="/q">a<br>b</a> ', n)],
    ["links around blocks", (n) => fill('<span>Foo</span> <a href="/x"><div>Card</div></a>', n)],
    ["lists nested deep", (n) => `${fill("<ul>", n)}${fill("<li>x", n / 4)}`],
    ["empty list items", (n) => fill("x<li></li>", n)],
    ["empty headings", (n) => fill("x<h2></h2>", n)],
    ["empty table cells and rows", (n) => fill("x<td></td><tr>", n)],
    ["preformatted tabs between blocks", (n) => `<pre>${fill("x\t<div>", n)}`],
    ["preformatted spaces before a bar", (n) => `<pre>x${fill(" ", n)}|y</pre>`],
  ])("stays linear on %s", (_, make) => {
    expectLinear(make, MB, { baseUrl: "https://site.example/" });
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
