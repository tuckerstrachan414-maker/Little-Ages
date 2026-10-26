/*
  Turns the single-file build into the page that gets published as a playable link. The
  host wraps a page in its own document skeleton, so this keeps only what goes inside:
  the title and font links first, then the script and styles, then the body's elements.
*/
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
const keep = head.split("\n").filter(l => !/<meta charset|<meta name="viewport"/.test(l)).join("\n");
const out = `${keep.trim()}\n${body.trim()}\n`;
if (!out.slice(0, 8192).includes("<title>")) throw new Error("the title must sit in the first 8KB of the page");
writeFileSync("dist/little-ages.html", out);
console.log(`dist/little-ages.html: ${(out.length / 1024).toFixed(1)} KB`);
