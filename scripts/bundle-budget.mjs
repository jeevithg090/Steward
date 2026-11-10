#!/usr/bin/env node
/**
 * Checks how much JavaScript the web app's first page load fetches: the entry script plus every
 * chunk `index.html` preloads. The chat, the computer and each page are their own chunks, fetched
 * when someone opens them, so they do not count here.
 *
 *   node scripts/bundle-budget.mjs [dist folder] [budget in kB]
 *
 * Defaults: apps/web/dist and 1,000 kB (minified, before gzip). Exits 1 above the budget.
 */
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(process.argv[2] ?? "apps/web/dist");
const budgetKb = Number(process.argv[3] ?? process.env.STEWARD_BUNDLE_BUDGET_KB ?? 1000);

const html = readFileSync(join(dist, "index.html"), "utf8");
const scripts = new Set();
for (const tag of html.match(/<(script|link)\b[^>]*>/g) ?? []) {
  const isEntry = tag.startsWith("<script") && /type="module"/.test(tag);
  const isPreload = tag.startsWith("<link") && /rel="modulepreload"/.test(tag);
  const src = /(?:src|href)="([^"]+\.js)"/.exec(tag)?.[1];
  if ((isEntry || isPreload) && src) scripts.add(src.replace(/^\//, ""));
}
if (scripts.size === 0) {
  console.error(`No entry script found in ${join(dist, "index.html")}. Build the web app first.`);
  process.exit(1);
}

let raw = 0;
let gzip = 0;
const rows = [];
for (const file of scripts) {
  const path = join(dist, file);
  const size = statSync(path).size;
  const zipped = gzipSync(readFileSync(path)).length;
  raw += size;
  gzip += zipped;
  rows.push({ file, size, zipped });
}
rows.sort((a, b) => b.size - a.size);

const kb = (n) => `${(n / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kB`;
for (const { file, size, zipped } of rows.slice(0, 8)) {
  console.log(`  ${kb(size).padStart(10)}  ${kb(zipped).padStart(9)} gzip  ${file}`);
}
if (rows.length > 8) console.log(`  … and ${rows.length - 8} smaller chunks`);
console.log(`First load: ${kb(raw)} of JavaScript (${kb(gzip)} gzip) in ${rows.length} files.`);

if (raw > budgetKb * 1000) {
  console.error(
    `That is over the budget of ${kb(budgetKb * 1000)}. Something large is loaded eagerly again.`,
  );
  process.exit(1);
}
console.log(`Within the budget of ${kb(budgetKb * 1000)}.`);
