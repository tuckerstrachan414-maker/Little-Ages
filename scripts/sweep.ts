/*
  A balance sweep: runs the headless world on many seeds at once and sums up how people
  fared, so a change to how they live can be checked against how they lived before it.
  node --experimental-strip-types scripts/sweep.ts --seeds 1-16 --years 10 [--jobs 4] [--save base.json] [--against base.json]
  Every run is the same as `npm run sim -- --size medium --seed N --years Y --bands 12 --summary`.
*/
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const [lo, hi] = arg("seeds", "1-16").split("-").map(Number);
const years = arg("years", "10"), size = arg("size", "medium"), bands = arg("bands", "12"), jobs = +arg("jobs", String(Math.max(1, cpus().length)));
const save = arg("save", ""), against = arg("against", "");
type Row = Record<string, number | string>;

function runOne(seed: number): Promise<Row> {
  return new Promise((done, fail) => {
    const ch = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/sim-headless.ts", "--size", size, "--seed", String(seed), "--years", years, "--bands", bands, "--summary"]);
    let out = "", err = "";
    ch.stdout.on("data", d => (out += d)); ch.stderr.on("data", d => (err += d));
    ch.on("close", code => {
      const line = out.split("\n").find(l => l.startsWith("SUMMARY "));
      if (code !== 0 || !line) fail(new Error(`seed ${seed} failed (${code}): ${err.slice(-2000)}`)); else done(JSON.parse(line.slice(8)));
    });
  });
}

const seeds: number[] = []; for (let s = lo; s <= (hi || lo); s++) seeds.push(s);
const rows: Row[] = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
  while (next < seeds.length) { const seed = seeds[next++]; const r = await runOne(seed); rows.push(r); process.stderr.write(`seed ${seed} done in ${r.secs}s\n`); }
}));
rows.sort((a, b) => +a.seed - +b.seed);
const KEYS = ["pop", "maxPop", "bands", "births", "deaths", "hunger", "cold", "illness", "moves", "splits", "meanStay", "long", "secs"];
const base: Row[] | null = against ? JSON.parse(readFileSync(against, "utf8")) : null;
console.log(["seed", ...KEYS].map(k => k.padStart(9)).join(""));
for (const r of rows) {
  const b = base?.find(x => x.seed === r.seed);
  console.log([String(r.seed).padStart(9), ...KEYS.map(k => (b ? `${fmt(+r[k] - +b[k], k)}` : fmt(+r[k], k)).padStart(9))].join("") + (b ? "  (change)" : ""));
}
const sum = (rs: Row[], k: string) => rs.reduce((a, r) => a + +r[k], 0);
const mean = (rs: Row[], k: string) => sum(rs, k) / Math.max(1, rs.length);
const sd = (xs: number[]) => { const m = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
console.log(["mean", ...KEYS.map(k => fmt(mean(rows, k), k))].map(v => v.padStart(9)).join(""));
if (base) {
  const paired = rows.filter(r => base.some(b => b.seed === r.seed));
  console.log("Per world, new minus old (mean, give or take one standard deviation):");
  for (const k of KEYS) {
    const d = paired.map(r => +r[k] - +base.find(b => b.seed === r.seed)![k]);
    console.log(`  ${k.padEnd(9)} ${fmt(d.reduce((a, x) => a + x, 0) / Math.max(1, d.length), k).padStart(9)} +/- ${fmt(sd(d), k)}   (old total ${fmt(sum(base.filter(b => paired.some(r => r.seed === b.seed)), k), k)}, new total ${fmt(sum(paired, k), k)})`);
  }
}
const ideas = new Map<string, number>(); for (const r of rows) for (const n of String(r.ideas).split("|").filter(Boolean)) ideas.set(n, (ideas.get(n) ?? 0) + 1);
console.log(`Known at the end, in how many of ${rows.length} worlds: ${[...ideas].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", ")}`);
for (const k of Object.keys(rows[0] ?? {})) if (!KEYS.includes(k) && !["seed", "years", "ideas"].includes(k)) console.log(`  ${k}: ${rows.map(r => r[k]).join(" ")}`);
if (save) writeFileSync(save, JSON.stringify(rows, null, 1));
function fmt(v: number, k: string): string { return k === "long" ? v.toFixed(3) : k === "meanStay" || k === "secs" ? v.toFixed(1) : Number.isInteger(v) ? String(v) : v.toFixed(1); }
