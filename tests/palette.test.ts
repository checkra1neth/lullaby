/**
 * Feature: lullaby-redesign, Property 4: Palette-lint completeness
 *
 * For any disallowed class string c, the palette-lint script shall exit
 * non-zero when run against a fixture file containing c.
 * For any allowed Tailwind class string a, it shall exit zero.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const DISALLOWED_CLASSES = [
  "bg-white",
  "text-white",
  "border-white",
  "bg-black",
  "text-black",
  "border-black",
  "text-gray-500",
  "bg-gray-100",
  "border-gray-300",
  "bg-indigo-600",
  "text-indigo-400",
  "border-indigo-500",
  "focus:ring-indigo-500",
  "hover:bg-indigo-500",
  "focus:border-indigo-500",
  "bg-blue-500",
  "text-purple-400",
];

const ALLOWED_CLASSES = [
  "bg-surface-low",
  "text-on-surface",
  "border-glass-border",
  "text-accent",
  "bg-bg",
  "text-on-surface-v",
];

function runLintOnFixture(content: string) {
  const tmpDir = mkdtempSync(join(tmpdir(), "palette-lint-"));
  const fixturePath = join(tmpDir, "Fixture.tsx");
  writeFileSync(fixturePath, content);
  const result = spawnSync(
    process.execPath,
    ["scripts/palette-lint.mjs", `--path=${tmpDir}/*.tsx`],
    { cwd: process.cwd(), encoding: "utf-8" },
  );
  rmSync(tmpDir, { recursive: true, force: true });
  return result.status;
}

describe("Palette-lint completeness (CP-6)", () => {
  it("exits non-zero for every disallowed class (Req 21.2, 21.3)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...DISALLOWED_CLASSES), (cls) => {
        const content = `export default function() { return <div className="${cls}" />; }`;
        const status = runLintOnFixture(content);
        expect(status).not.toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("exits zero for allowed classes (Req 21.2)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_CLASSES), (cls) => {
        const content = `export default function() { return <div className="${cls}" />; }`;
        const status = runLintOnFixture(content);
        expect(status).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
