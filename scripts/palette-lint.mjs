#!/usr/bin/env node

// Palette-lint script (Req 21).
//
// Scans app/**/*.{tsx,css} for disallowed Tailwind classes and off-brand
// hex literals. Skips the bodies of SVG <mask>, <image>, and <filter>
// elements.
//
// Exit codes:
//   0 — no violations
//   1 — one or more violations found

import { globSync } from "glob";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DISALLOWED_CLASS_RE = new RegExp(
  [
    "\\b(?:bg|text|border)-white\\b",
    "\\b(?:bg|text|border)-black\\b",
    "\\b(?:bg|text|border)-gray-\\d{2,3}\\b",
    "\\b(?:bg|text|border)-indigo-\\d{2,3}\\b",
    "\\b(?:bg|text|border)-blue-\\d{2,3}\\b",
    "\\b(?:bg|text|border)-purple-\\d{2,3}\\b",
    "\\bfocus:ring-indigo-\\d{2,3}\\b",
    "\\bhover:bg-indigo-\\d{2,3}\\b",
    "\\bfocus:border-indigo-\\d{2,3}\\b",
  ].join("|"),
  "g",
);

const HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

const ALLOWED_HEXES = new Set([
  // Brand_Palette
  "#0a0820",
  "#08061a",
  "#120f2c",
  "#1a1640",
  "#241e54",
  "#f5f0eb",
  "#b8b0c8",
  "#f6c177",
  "#d99f4f",
]);

function skipSvgFilterBodies(text) {
  // Naïve but sufficient: strip everything between <mask …>…</mask>,
  // <image …>…</image>, and <filter …>…</filter> tags.
  return text
    .replace(/<mask\b[^>]*>[\s\S]*?<\/mask>/gi, "")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, "")
    .replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/gi, "");
}

function lintFile(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const text = skipSvgFilterBodies(raw);
  const violations = [];

  // Disallowed Tailwind classes
  for (const match of text.matchAll(DISALLOWED_CLASS_RE)) {
    const prefix = text.slice(0, match.index);
    const line = prefix.split("\n").length;
    const col = prefix.length - prefix.lastIndexOf("\n");
    violations.push({ line, col, msg: match[0] });
  }

  // Hex literals
  for (const match of text.matchAll(HEX_RE)) {
    const hex = match[0].toLowerCase();
    if (ALLOWED_HEXES.has(hex)) continue;
    const prefix = text.slice(0, match.index);
    const line = prefix.split("\n").length;
    const col = prefix.length - prefix.lastIndexOf("\n");
    violations.push({ line, col, msg: hex });
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const customPath = args.find((a) => a.startsWith("--path="))?.slice(7);
  const root = join(__dirname, "..");
  const pattern = customPath || "app/**/*.{tsx,css}";
  const files = globSync(pattern, { cwd: root });
  let total = 0;

  for (const f of files) {
    const absPath = f.startsWith("/") ? f : join(root, f);
    const v = lintFile(absPath);
    for (const { line, col, msg } of v) {
      console.log(`${absPath}:${line}:${col} ${msg}`);
      total++;
    }
  }

  if (total > 0) {
    console.error(`\n${total} palette violation(s) found.`);
    process.exit(1);
  }

  console.log("Palette lint: clean.");
  process.exit(0);
}

main();
