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

  it("ends the head at <body> when </head> was left out", () => {
    expect(htmlToText("<html><head><title>T</title><body><p>Visible</p>").text).toBe("Visible");
  });

  it("can leave links out", () => {
    expect(htmlToText('<p>See <a href="https://a.example/">this</a></p>', { links: false }).text).toBe(
      "See this",
    );
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
