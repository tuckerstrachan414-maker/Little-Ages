import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { bake } from "../src/sim/world/bake.ts";
import { hash2, Rng } from "../src/shared/rng.ts";
import { fbm } from "../src/shared/noise.ts";
import { Biome, Flag, type WorldData } from "../src/shared/types.ts";

/* Medium worlds keep the suite quick; one Large world checks the default size. */
const worlds = new Map<string, WorldData>();
const world = (size: "medium" | "large", seed: number) => { const k = `${size}:${seed}`; let w = worlds.get(k); if (!w) { w = generateWorld(size, seed, () => {}); worlds.set(k, w); } return w; };

function checksum(...arrays: ArrayLike<number>[]): number {
  let h = 2166136261;
  for (const a of arrays) for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 1000) & 0xffffffff; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

describe("randomness", () => {
  it("hash and noise stay in range and repeat exactly", () => {
    for (let i = 0; i < 2000; i++) { const v = hash2(i * 7, i * 13 - 500, 42); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect(fbm(1.234, 5.678, 9)).toBe(fbm(1.234, 5.678, 9));
    const a = new Rng(5), b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe("world generation", () => {
  it("is deterministic: the same seed makes the same world", () => {
    const a = generateWorld("medium", 11, () => {}), b = generateWorld("medium", 11, () => {});
    expect(checksum(a.elev, a.biome, a.flags, a.tree, a.temp, a.rain)).toBe(checksum(b.elev, b.biome, b.flags, b.tree, b.temp, b.rain));
    expect(checksum(bake(a, 2))).toBe(checksum(bake(b, 2)));
  });

  it("different seeds make different worlds", () => {
    expect(checksum(world("medium", 1).biome)).not.toBe(checksum(world("medium", 2).biome));
  });

  it.each([1, 2, 3])("medium seed %i keeps about 37% land", seed => {
    expect(world("medium", seed).landFraction).toBeGreaterThan(0.35);
    expect(world("medium", seed).landFraction).toBeLessThan(0.39);
  });

  it("the default Large world is the right size, made fast enough", () => {
    const w = world("large", 12);
    expect([w.w, w.h]).toEqual([2048, 1024]);
    expect(w.landFraction).toBeGreaterThan(0.35);
    expect(w.genMs).toBeLessThan(15000);
  }, 30000);

  it.each([1, 2, 3])("medium seed %i has a few huge continents, not a scatter of islands", seed => {
    const w = world("medium", seed), seen = new Uint8Array(w.w * w.h), sizes: number[] = [];
    let land = 0;
    for (let s = 0; s < seen.length; s++) {
      if (seen[s] || w.elev[s] < 0) continue;
      let n = 0; const st = [s]; seen[s] = 1;
      while (st.length) { const i = st.pop()!; n++; const x = i % w.w, y = (i / w.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue; const j = yy * w.w + xx; if (!seen[j] && w.elev[j] >= 0) { seen[j] = 1; st.push(j); } } }
      sizes.push(n); land += n;
    }
    sizes.sort((a, b) => b - a);
    const big = sizes.filter(n => n > land * 0.1).length;
    expect(sizes[0] / land).toBeGreaterThan(0.25);   /* the largest continent is a big share of all land */
    expect(big).toBeGreaterThanOrEqual(1);
    expect(big).toBeLessThanOrEqual(5);
    expect(sizes.length).toBeGreaterThan(5);         /* and there are islands besides */
  });

  it.each([1, 2, 3])("medium seed %i: every river reaches the sea or a lake", seed => {
    const w = world("medium", seed), N = w.w * w.h, reach = new Uint8Array(N), st: number[] = [];
    for (let i = 0; i < N; i++) if (w.flags[i] & (Flag.Ocean | Flag.Lake)) { reach[i] = 1; st.push(i); }
    while (st.length) { const i = st.pop()!, x = i % w.w, y = (i / w.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue; const j = yy * w.w + xx; if (!reach[j] && (w.flags[j] & Flag.River)) { reach[j] = 1; st.push(j); } } }
    let rivers = 0, stranded = 0;
    for (let i = 0; i < N; i++) if (w.flags[i] & Flag.River) { rivers++; if (!reach[i]) stranded++; }
    expect(rivers).toBeGreaterThan(500);
    expect(stranded).toBe(0);
  });

  it.each([1, 2, 3])("medium seed %i has a believable mix of climates", seed => {
    const w = world("medium", seed), count = new Map<number, number>(); let land = 0;
    for (let i = 0; i < w.biome.length; i++) if (!(w.flags[i] & Flag.Water)) { land++; count.set(w.biome[i], (count.get(w.biome[i]) ?? 0) + 1); }
    const share = (...bs: number[]) => bs.reduce((a, b) => a + (count.get(b) ?? 0), 0) / land;
    expect(share(Biome.TemperateForest, Biome.TemperateRainforest, Biome.Taiga, Biome.TropicalForest, Biome.Rainforest)).toBeGreaterThan(0.25);
    expect(share(Biome.Grassland, Biome.Savanna, Biome.Shrubland, Biome.ColdSteppe)).toBeGreaterThan(0.08);
    expect(share(Biome.HotDesert, Biome.ColdDesert)).toBeGreaterThan(0.02);
    expect(share(Biome.HotDesert, Biome.ColdDesert)).toBeLessThan(0.3);
    expect(share(Biome.Mountain, Biome.SnowPeak)).toBeGreaterThan(0.002);
    for (const [, n] of count) expect(n / land).toBeLessThan(0.4);
  });

  it("forests hold many kinds of tree, and autumn colors them", () => {
    const w = world("medium", 1), kinds = new Set<number>();
    for (const t of w.tree) if (t) kinds.add(t);
    expect(kinds.size).toBeGreaterThanOrEqual(14);
    const summer = bake(w, 1), autumn = bake(w, 2);
    let changed = 0, trees = 0;
    for (let i = 0; i < w.tree.length; i++) if (w.tree[i] >= 1 && w.tree[i] <= 5) { trees++; if (Math.abs(summer[i * 4] - autumn[i * 4]) > 20) changed++; }
    expect(changed / trees).toBeGreaterThan(0.6);   /* broadleaf woods turn red, orange and yellow */
  });
});
