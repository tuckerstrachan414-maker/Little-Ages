/* Dev tool: generate a world headless and write PNGs of each season and map mode. */
import { generateWorld, STAGES } from "../src/sim/world/gen.ts";
import { bake } from "../src/sim/world/bake.ts";
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import type { SizeKey, Season, MapMode } from "../src/shared/types.ts";

function png(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const [size = "large", seedS = "7", out = "/tmp/world"] = process.argv.slice(2);
let last = -1;
const wd = generateWorld(size as SizeKey, +seedS, (s, p) => { if (s !== last) { last = s; process.stdout.write(`\n${STAGES[s]} `); } else if (Math.random() < 0.02) process.stdout.write(`${Math.round(p * 100)}% `); });
console.log(`\n${size} seed ${seedS}: ${wd.w}x${wd.h}, land ${(wd.landFraction * 100).toFixed(1)}%, generated in ${(wd.genMs / 1000).toFixed(2)}s`);
const counts = new Map<number, number>(); for (const b of wd.biome) counts.set(b, (counts.get(b) || 0) + 1);
console.log("biomes:", [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}:${(n / wd.biome.length * 100).toFixed(1)}%`).join(" "));
let trees = 0; for (const t of wd.tree) if (t) trees++; console.log("trees:", trees);
const seasons = (process.env.SEASONS || "1").split(",").map(Number) as Season[];
for (const s of seasons) { const t = performance.now(); const px = bake(wd, s); writeFileSync(`${out}-s${s}.png`, png(wd.w, wd.h, px)); console.log(`season ${s} baked in ${(performance.now() - t).toFixed(0)}ms`); }
for (const m of (process.env.MODES || "").split(",").filter(Boolean) as MapMode[]) writeFileSync(`${out}-${m}.png`, png(wd.w, wd.h, bake(wd, 1, m)));
