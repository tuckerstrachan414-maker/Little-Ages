import { Biome, Flag, Tree, type WorldData } from "../shared/types.ts";
import { Rng } from "../shared/rng.ts";

/*
  Pasture, small game and fish, kept as amounts per patch of land or water rather than one by
  one. Grass and browse feed the herds and regrow with the seasons, so a crowded range is
  eaten down and its herds go hungry, breed less and move on. Each patch can carry so many rabbits or fish, set by its ground: meadows and woods
  edges for rabbits, shallow seas, lakes and rivers for fish. They breed in spring and
  summer, starve and freeze in hard winters, and wolves living nearby eat rabbits. Hunters
  and fishers will draw on the same numbers, so a patch can be emptied and must recover.
*/

export const CELL = 16;
const RABBIT_K: Partial<Record<number, number>> = {
  [Biome.Grassland]: 1, [Biome.Shrubland]: 0.9, [Biome.ColdSteppe]: 0.65, [Biome.Savanna]: 0.6, [Biome.TemperateForest]: 0.7,
  [Biome.TemperateRainforest]: 0.45, [Biome.Taiga]: 0.5, [Biome.Tundra]: 0.35, [Biome.TropicalForest]: 0.45, [Biome.Rainforest]: 0.3,
  [Biome.Swamp]: 0.3, [Biome.HotDesert]: 0.1, [Biome.ColdDesert]: 0.15, [Biome.Beach]: 0.1, [Biome.Mountain]: 0.15,
};
/* grass for grazers (aurochs, horses, mammoths) and browse, the leaves, shoots and berries of
   woods and scrub, for browsers (deer, bears). Different mouths, different pastures. */
const GRASS_K: Partial<Record<number, number>> = {
  [Biome.Grassland]: 1, [Biome.Savanna]: 0.9, [Biome.ColdSteppe]: 0.8, [Biome.Tundra]: 0.5, [Biome.Shrubland]: 0.5, [Biome.Swamp]: 0.4,
  [Biome.TemperateForest]: 0.25, [Biome.TropicalForest]: 0.2, [Biome.Taiga]: 0.15, [Biome.TemperateRainforest]: 0.15, [Biome.Rainforest]: 0.1,
  [Biome.Mountain]: 0.2, [Biome.Beach]: 0.05, [Biome.HotDesert]: 0.06, [Biome.ColdDesert]: 0.1,
};
const BROWSE_K: Partial<Record<number, number>> = {
  [Biome.TemperateForest]: 1, [Biome.TemperateRainforest]: 0.8, [Biome.TropicalForest]: 0.8, [Biome.Shrubland]: 0.8, [Biome.Taiga]: 0.7,
  [Biome.Rainforest]: 0.6, [Biome.Swamp]: 0.6, [Biome.Savanna]: 0.4, [Biome.Tundra]: 0.2, [Biome.Grassland]: 0.15, [Biome.Mountain]: 0.15,
  [Biome.ColdSteppe]: 0.1, [Biome.Beach]: 0.05, [Biome.HotDesert]: 0.05, [Biome.ColdDesert]: 0.05,
};
/** Share of grass in a diet; the rest is browse. */
export type Diet = number;
const FISH_K: Partial<Record<number, number>> = { [Biome.Shelf]: 1, [Biome.Ocean]: 0.45, [Biome.DeepOcean]: 0.15, [Biome.Lake]: 0.9, [Biome.River]: 0.8 };
/* plant food people can gather: fruit, nuts, seeds, greens and roots, plus shellfish on the shore */
const PLANT_K: Partial<Record<number, number>> = {
  [Biome.TemperateForest]: 0.75, [Biome.TemperateRainforest]: 0.55, [Biome.TropicalForest]: 0.85, [Biome.Rainforest]: 0.7, [Biome.Savanna]: 0.7,
  [Biome.Grassland]: 0.55, [Biome.Shrubland]: 0.6, [Biome.Swamp]: 0.55, [Biome.Taiga]: 0.32, [Biome.Tundra]: 0.18, [Biome.ColdSteppe]: 0.3,
  [Biome.Beach]: 0.75, [Biome.Shingle]: 0.6, [Biome.Cliff]: 0.2, [Biome.Mountain]: 0.12, [Biome.HotDesert]: 0.06, [Biome.ColdDesert]: 0.05,
};
/* trees and bushes that feed people: berries, acorns, beechnuts, dates and coconuts, baobab fruit, cattail roots */
const FOOD_TREE: Partial<Record<number, number>> = { [Tree.BerryBush]: 3, [Tree.Oak]: 1.2, [Tree.Beech]: 1, [Tree.Palm]: 1.6, [Tree.Baobab]: 2, [Tree.Jungle]: 0.6, [Tree.Reeds]: 1.2, [Tree.Willow]: 0.2 };
/** Food units (one person's food for one day) a patch holds when fully stocked. */
export const PLANT_UNITS = 120, FISH_UNITS = 150, RABBIT_UNITS = 20;

export class Ecology {
  readonly gw: number; readonly gh: number;
  readonly rabbitK: Float32Array; readonly fishK: Float32Array; readonly grassK: Float32Array; readonly browseK: Float32Array; readonly coldness: Float32Array;
  readonly plantK: Float32Array;
  rabbits: Float32Array; fish: Float32Array; grass: Float32Array; browse: Float32Array; plants: Float32Array;
  private readonly w: WorldData;
  /** soil moisture per patch and what each patch is used to, shared with the weather once there is one (an ordinary year without it) */
  private moist: Float32Array | null = null; private normal: Float32Array | null = null;
  setMoisture(m: Float32Array, normal: Float32Array): void { this.moist = m; this.normal = normal; }
  /** How wet a patch is against what it is used to: 1 in an ordinary year. */
  wetness(c: number): number { return this.moist && this.normal ? Math.min(1.15, this.moist[c] / Math.max(0.02, this.normal[c])) : 1; }
  constructor(w: WorldData, seed: number) {
    this.w = w;
    const gw = this.gw = Math.ceil(w.w / CELL), gh = this.gh = Math.ceil(w.h / CELL), n = gw * gh;
    this.rabbitK = new Float32Array(n); this.fishK = new Float32Array(n); this.grassK = new Float32Array(n); this.browseK = new Float32Array(n); this.coldness = new Float32Array(n);
    const cnt = new Float32Array(n);
    this.plantK = new Float32Array(n);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const i = y * w.w + x, c = ((y / CELL) | 0) * gw + ((x / CELL) | 0), b = w.biome[i];
      cnt[c]++; this.coldness[c] += 1 - w.temp[i] / 255;
      if (w.flags[i] & Flag.Water) this.fishK[c] += FISH_K[b] ?? 0.3; else { this.rabbitK[c] += RABBIT_K[b] ?? 0; this.grassK[c] += GRASS_K[b] ?? 0; this.browseK[c] += BROWSE_K[b] ?? 0; this.plantK[c] += (PLANT_K[b] ?? 0) * (1 + (FOOD_TREE[w.tree[i]] ?? 0)); }
    }
    const r = new Rng(seed * 13 + 9);
    this.rabbits = new Float32Array(n); this.fish = new Float32Array(n); this.grass = new Float32Array(n); this.browse = new Float32Array(n); this.plants = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      this.rabbitK[c] /= cnt[c]; this.fishK[c] /= cnt[c]; this.grassK[c] /= cnt[c]; this.browseK[c] /= cnt[c]; this.coldness[c] /= cnt[c];
      this.plantK[c] = Math.min(1.4, this.plantK[c] / cnt[c]); this.plants[c] = this.plantK[c] * 0.85;
      this.grass[c] = this.grassK[c] * 0.9; this.browse[c] = this.browseK[c] * 0.9;
      this.rabbits[c] = this.rabbitK[c] * r.range(0.5, 0.9); this.fish[c] = this.fishK[c] * r.range(0.6, 0.95);
    }
  }
  private cellOf(x: number, y: number): number { return Math.min(this.gh - 1, Math.max(0, (y / CELL) | 0)) * this.gw + Math.min(this.gw - 1, Math.max(0, (x / CELL) | 0)); }
  /** What a patch can grow, counted again after its trees have changed: felled nut and fruit trees feed nobody. */
  recount(c: number): void {
    const w = this.w, gx = (c % this.gw) * CELL, gy = ((c / this.gw) | 0) * CELL;
    let k = 0, n = 0;
    for (let y = gy; y < Math.min(w.h, gy + CELL); y++) for (let x = gx; x < Math.min(w.w, gx + CELL); x++) {
      const i = y * w.w + x; n++; if (w.flags[i] & Flag.Water) continue;
      k += (PLANT_K[w.biome[i]] ?? 0) * (1 + (FOOD_TREE[w.tree[i]] ?? 0));
    }
    if (n) { this.plantK[c] = Math.min(1.4, k / n); this.plants[c] = Math.min(this.plants[c], this.plantK[c]); }
  }
  /** A predator takes small game from the patch it stands in; returns how much it found (0..1). */
  hunt(x: number, y: number, want: number): number {
    const c = this.cellOf(x, y), got = Math.min(want, this.rabbits[c] * 0.5);
    this.rabbits[c] -= got; return this.rabbitK[c] > 0 ? got / want : 0;
  }
  /** Animals crop the patch they stand in, `grassShare` of it grass and the rest browse; returns the share of their need they found. */
  graze(x: number, y: number, want: number, grassShare: Diet): number {
    if (want <= 0) return 1;
    const c = this.cellOf(x, y), wg = want * grassShare, wb = want - wg;
    const g = Math.min(wg, this.grass[c] * 0.6), b = Math.min(wb, this.browse[c] * 0.6);
    this.grass[c] -= g; this.browse[c] -= b;
    return (g + b) / want;
  }
  forageAt(x: number, y: number, grassShare: Diet): number { const c = this.cellOf(x, y); return this.grass[c] * grassShare + this.browse[c] * (1 - grassShare); }
  cell(x: number, y: number): number { return this.cellOf(x, y); }

  /* ---- people's food, in food units (a day's food for one person) ---- */
  /** What a gatherer could pick in the patch at (x, y), and picks `want` of it. Takes at most a `share` of what stands (more with a digging stick), so a patch is never stripped in one visit. */
  gather(x: number, y: number, want: number, share = 0.06): number { const c = this.cellOf(x, y), got = Math.min(want, this.plants[c] * PLANT_UNITS * share); this.plants[c] -= got / PLANT_UNITS; return got; }
  plantsAt(x: number, y: number): number { return this.plants[this.cellOf(x, y)] * PLANT_UNITS; }
  /** Fishing from the shore: the catch depends on how many fish the water holds and the fisher's skill; a net reaches a bigger `share` of them. */
  catchFish(x: number, y: number, want: number, share = 0.03): number { const c = this.cellOf(x, y), got = Math.min(want, this.fish[c] * FISH_UNITS * share); this.fish[c] -= got / FISH_UNITS; return got; }
  fishAt(x: number, y: number): number { return this.fish[this.cellOf(x, y)] * FISH_UNITS; }
  /** Snaring rabbits and hares. */
  snare(x: number, y: number, want: number): number { const c = this.cellOf(x, y), got = Math.min(want, this.rabbits[c] * RABBIT_UNITS * 0.08); this.rabbits[c] -= got / RABBIT_UNITS; return got; }
  rabbitsAt(x: number, y: number): number { return this.rabbits[this.cellOf(x, y)] * RABBIT_UNITS; }
  /** Once a game day. */
  daily(season: number): void {
    /* grass grows back fast in spring, slowly in summer, hardly at all under snow */
    const growG = [0.12, 0.07, 0.03, 0.006][season], growB = [0.08, 0.06, 0.03, 0.008][season];
    for (let c = 0; c < this.grass.length; c++) {
      /* grass and browse grow with the rain in the soil, and brown off when it is gone */
      const snow = season === 3 ? 1 - this.coldness[c] : 1, wet = 0.25 + 0.75 * this.wetness(c);
      this.grass[c] += growG * (this.grassK[c] - this.grass[c]) * snow * wet;
      this.browse[c] += growB * (this.browseK[c] - this.browse[c]) * snow * wet;
      if (this.wetness(c) < 0.5) this.grass[c] *= 1 - 0.01 * (1 - this.wetness(c) * 2);
    }
    /* plant food grows through spring and summer and ripens in autumn; in the cold, winter
       buries what is left. The tropics have no winter to speak of. */
    const growP = [0.13, 0.11, 0.09, 0.014][season];
    for (let c = 0; c < this.plants.length; c++) {
      const K = this.plantK[c]; if (K <= 0) continue;
      const cold = this.coldness[c], tropic = cold < 0.32 ? 1 : 0;
      const m = this.wetness(c), g = (season === 3 ? (tropic ? 0.06 : growP * Math.max(0, 1 - cold * 1.6)) : growP) * (0.25 + 0.75 * m);
      let p = this.plants[c] + g * (K - this.plants[c]);
      if (season === 3 && !tropic) p *= 1 - 0.015 * Math.min(1, cold * 1.5);
      /* in a drought the plants die back */
      if (m < 0.5) p *= 1 - 0.01 * (1 - m * 2);
      this.plants[c] = Math.max(0.02 * K, p);
    }
    const growR = [0.09, 0.05, 0.01, 0][season], growF = [0.05, 0.04, 0.015, 0.004][season];
    for (let c = 0; c < this.rabbits.length; c++) {
      const K = this.rabbitK[c];
      if (K > 0) {
        let r = this.rabbits[c];
        r += growR * r * (1 - r / K);
        if (season === 3) r *= 1 - 0.012 - 0.03 * Math.max(0, this.coldness[c] - 0.55);   /* hard winters bite */
        this.rabbits[c] = Math.max(0.02 * K, Math.min(K, r));   /* a few always hang on to re-seed the patch */
      }
      const F = this.fishK[c];
      if (F > 0) { const f = this.fish[c]; this.fish[c] = Math.max(0.03 * F, Math.min(F, f + growF * f * (1 - f / F))); }
    }
  }
  /** Snapshot for the renderer: 0..255 per patch. */
  snapshot(): { rabbits: Uint8Array; fish: Uint8Array } {
    const n = this.rabbits.length, ra = new Uint8Array(n), fi = new Uint8Array(n);
    for (let c = 0; c < n; c++) { ra[c] = Math.round(Math.min(1, this.rabbits[c]) * 255); fi[c] = Math.round(Math.min(1, this.fish[c]) * 255); }
    return { rabbits: ra, fish: fi };
  }
  total(): { rabbits: number; fish: number } {
    let r = 0, f = 0; for (let c = 0; c < this.rabbits.length; c++) { r += this.rabbits[c]; f += this.fish[c]; }
    /* a fully stocked patch of meadow holds about forty rabbits; a shallow-sea patch a few hundred fish */
    return { rabbits: Math.round(r * 40), fish: Math.round(f * 300) };
  }
}
