import { Biome, Flag, Tree, type WorldData } from "../../shared/types.ts";
import { hash2 } from "../../shared/rng.ts";
import { vnoise } from "../../shared/noise.ts";
import { Mat, MATS } from "../economy/goods.ts";

/*
  What lies in the ground, laid down with the world: clay along the rivers and in the swamps,
  flint in the chalk lowlands and on shingle shores, stone under every hill, copper and silver
  in the mountains, tin in the hills (never near the copper, so bronze takes reach or trade),
  iron in the high ground and the bogs, gold in the rivers that drain the mountains, salt in
  the desert pans and on arid shores, reeds in the wet places, obsidian under the peaks. Each
  deposit is a place with so much in it; nobody knows it is there until someone finds it.
*/

export interface Deposit {
  id: number; kind: number;
  x: number; y: number;
  /** how far around the center it reaches */
  r: number;
  /** how good a deposit: 0.5 poor .. 1.5 rich */
  rich: number;
  /** what it held when the world was made, and what is left */
  amount: number; left: number;
}

const STEP = 4;
/** How far apart two deposits of a kind are, at least. */
const SPACING: Partial<Record<number, number>> = { [Mat.Clay]: 24, [Mat.Reeds]: 16, [Mat.Flint]: 24, [Mat.Stone]: 20, [Mat.Copper]: 60, [Mat.Tin]: 80, [Mat.Iron]: 50, [Mat.Gold]: 70, [Mat.Silver]: 80, [Mat.Salt]: 60, [Mat.Obsidian]: 60 };

export function generateDeposits(w: WorldData, seed: number): Deposit[] {
  const { w: W, h: H, elev, biome, flags, tree } = w;
  const at = (x: number, y: number) => y * W + x;
  const near = (x: number, y: number, r: number, test: (i: number) => boolean): boolean => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; if (test(at(xx, yy))) return true; }
    return false;
  };
  const cands: { kind: number; x: number; y: number; score: number }[] = [];
  for (let y = 2; y < H - 2; y += STEP) for (let x = 2; x < W - 2; x += STEP) {
    const i = at(x, y), b = biome[i], e = elev[i], f = flags[i];
    if (f & Flag.Water || b === Biome.IceSheet || b === Biome.SnowPeak) continue;
    const h = (k: number) => hash2(x, y, seed + 300 + k);
    const mountainNear = near(x, y, 2, j => biome[j] === Biome.Mountain || biome[j] === Biome.Cliff);
    /* clay along fresh water and in the swamps */
    if (e < 0.2 && (b === Biome.Swamp || near(x, y, 2, j => (flags[j] & (Flag.River | Flag.Lake)) !== 0)) && h(1) < 0.1) cands.push({ kind: Mat.Clay, x, y, score: h(1) });
    /* reeds where they grow */
    if (tree[i] === Tree.Reeds && h(2) < 0.5) cands.push({ kind: Mat.Reeds, x, y, score: h(2) });
    /* flint: a chalk band through the lowlands, and the shingle shores */
    if ((e < 0.3 && !tree[i] && vnoise(x / 60, y / 60, seed + 321) > 0.62 && h(3) < 0.3) || ((b === Biome.Shingle || b === Biome.Cliff) && h(3) < 0.5)) cands.push({ kind: Mat.Flint, x, y, score: h(3) });
    /* stone under every hill */
    if (mountainNear && h(4) < 0.25) cands.push({ kind: Mat.Stone, x, y, score: h(4) });
    /* the metals: veins through the high ground */
    if ((e > 0.3 && e < 0.6 || mountainNear) && vnoise(x / 40, y / 40, seed + 322) > 0.7 && h(5) < 0.3) cands.push({ kind: Mat.Copper, x, y, score: h(5) });
    if (e > 0.25 && e < 0.5 && vnoise(x / 48, y / 48, seed + 323) > 0.78 && h(6) < 0.25) cands.push({ kind: Mat.Tin, x, y, score: h(6) });
    if ((mountainNear && e > 0.35 && vnoise(x / 36, y / 36, seed + 324) > 0.55 && h(7) < 0.3) || (b === Biome.Swamp && h(7) < 0.03)) cands.push({ kind: Mat.Iron, x, y, score: h(7) });
    if (b === Biome.Mountain && vnoise(x / 30, y / 30, seed + 325) > 0.75 && h(8) < 0.2) cands.push({ kind: Mat.Silver, x, y, score: h(8) });
    /* salt: desert pans far from water, and arid shores */
    if ((b === Biome.HotDesert || b === Biome.ColdDesert) && h(9) < 0.03 && !near(x, y, 12, j => (flags[j] & Flag.Water) !== 0)) cands.push({ kind: Mat.Salt, x, y, score: h(9) });
    if (b === Biome.Beach && w.rain[i] < 60 && near(x, y, 1, j => (flags[j] & Flag.Ocean) !== 0) && h(9) < 0.08) cands.push({ kind: Mat.Salt, x, y, score: h(9) });
    /* obsidian under the peaks */
    if (near(x, y, 6, j => biome[j] === Biome.SnowPeak) && vnoise(x / 24, y / 24, seed + 326) > 0.7 && h(10) < 0.2) cands.push({ kind: Mat.Obsidian, x, y, score: h(10) });
  }
  /* gold where rivers come down from the mountains: river tiles are water, so they are scanned apart */
  for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
    const i = at(x, y); if (!(flags[i] & Flag.River) || elev[i] < 0.3) continue;
    const h = hash2(x, y, seed + 311); if (h < 0.15) cands.push({ kind: Mat.Gold, x, y, score: h });
  }
  cands.sort((a, b) => a.score - b.score || a.kind - b.kind || a.y - b.y || a.x - b.x);
  /* thin them, so deposits of a kind keep their distance; tin keeps clear of copper */
  const out: Deposit[] = [], placed = new Map<number, { x: number; y: number }[]>();
  const clear = (kind: number, x: number, y: number, d: number) => !(placed.get(kind) ?? []).some(p => Math.hypot(p.x - x, p.y - y) < d);
  let id = 1;
  for (const c of cands) {
    const sp = SPACING[c.kind] ?? 30;
    if (!clear(c.kind, c.x, c.y, sp)) continue;
    if (c.kind === Mat.Tin && !clear(Mat.Copper, c.x, c.y, 40)) continue;
    if (c.kind === Mat.Copper && !clear(Mat.Tin, c.x, c.y, 40)) continue;
    const rich = 0.6 + hash2(c.x, c.y, seed + 333) * 0.9, base = MATS[c.kind].amount;
    const amount = Math.round(base * rich);
    const r = c.kind === Mat.Stone ? 5 : c.kind === Mat.Clay ? 4 : c.kind === Mat.Reeds || c.kind === Mat.Flint ? 3 : 2;
    out.push({ id: id++, kind: c.kind, x: c.x + 0.5, y: c.y + 0.5, r, rich, amount, left: amount });
    let l = placed.get(c.kind); if (!l) { l = []; placed.set(c.kind, l); } l.push({ x: c.x, y: c.y });
  }
  return out;
}
