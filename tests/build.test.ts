import { describe, it, expect, afterAll } from "vitest";
import { build } from "vite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
  The published page declares no charset, so a browser may read it as Windows-1252. A raw
  non-ASCII byte then turns into another character, and a regex that held one can stop parsing,
  which leaves a blank page. So the built page must be plain ASCII.
*/

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "little-ages-build-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("the built page", () => {
  it("is plain ASCII, so it reads the same under any encoding", async () => {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    const html = readFileSync(join(outDir, "index.html"));
    expect(html.findIndex(b => b > 0x7f)).toBe(-1);
  });
});
