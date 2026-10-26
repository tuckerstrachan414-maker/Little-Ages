import { Biome, Flag, Tree } from "../../shared/types.ts";
import { fbm } from "../../shared/noise.ts";
import { hash2 } from "../../shared/rng.ts";

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
  Distance from every ocean tile to the nearest land (true straight-line distance, so the
  shelves and depth bands round off around islands instead of forming diamonds; capped at
  255), and from land tiles to the sea (breadth-first, capped at 8).
*/
export function distances(w: number, h: number, elev: Float32Array, flags: Uint8Array) {
  const N = w * h, toLand = new Uint8Array(N), toSea = new Uint8Array(N).fill(255);
  const INF = 1e20, g = new Float32Array(N), n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { const i = y * w + x; f[y] = elev[i] >= 0 && !(flags[i] & Flag.Lake) ? 0 : INF; }
    edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) toLand[y * w + x] = Math.min(255, Math.round(Math.sqrt(d[x])));
  }
  const q = new Int32Array(N); let qn = 0;
  for (let i = 0; i < N; i++) if (elev[i] < 0) { toSea[i] = 0; q[qn++] = i; }
  for (let h0 = 0; h0 < qn; h0++) { const i = q[h0], x = i % w, y = (i / w) | 0, dd = toSea[i]; if (dd >= 8) continue;
    for (const [dx, dy] of NB4) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (toSea[k] > dd + 1) { toSea[k] = dd + 1; q[qn++] = k; } } }
  return { toLand, toSea };
}
/* One dimension of the exact squared distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

export function classify(w: number, h: number, elev: Float32Array, temp: Float32Array, rain: Float32Array, flags: Uint8Array, toLand: Uint8Array, toSea: Uint8Array, seed: number, biome: Uint8Array, depth: Uint8Array) {
  const S = h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, e = elev[i], t = temp[i], p = rain[i], f = flags[i];
    if (e < 0) {
      flags[i] |= Flag.Water | Flag.Ocean;
      const d = toLand[i]; depth[i] = d;
      const swirl = (fbm(x / S * 20, y / S * 20, seed + 81, 3) - 0.5) * 6;
      biome[i] = d + swirl < 4 || e > -0.06 ? Biome.Shelf : d + swirl * 2 < 26 ? Biome.Ocean : Biome.DeepOcean;
      continue;
    }
    if (f & Flag.Lake) { biome[i] = Biome.Lake; continue; }
    if (f & Flag.River) { biome[i] = Biome.River; continue; }
    if (toSea[i] <= 2) flags[i] |= Flag.Coast;
    /* slope from neighbors, for cliffs and rock */
    const ex = elev[i + (x < w - 1 ? 1 : 0)] - elev[i - (x > 0 ? 1 : 0)], ey = elev[i + (y < h - 1 ? w : 0)] - elev[i - (y > 0 ? w : 0)];
    const slope = Math.hypot(Math.max(0, ex), Math.max(0, ey)) + Math.hypot(Math.min(0, ex), Math.min(0, ey));
    const snowLine = 0.6 + t * 0.5, rockLine = 0.5 + t * 0.32, steep = 0.1 * 1024 / w;
    const nn = fbm(x / S * 30, y / S * 30, seed + 91, 3) - 0.5;
    let b: number;
    if (e > snowLine + nn * 0.06) b = Biome.SnowPeak;
    else if (e > rockLine + nn * 0.08 || (slope > steep && e > 0.2)) b = Biome.Mountain;
    else if (toSea[i] <= 2 && e < 0.035) b = slope > 0.018 * 1024 / w ? Biome.Cliff : t < 0.3 ? Biome.Shingle : (toSea[i] <= 1 || hash2(x, y, seed) < 0.5 ? Biome.Beach : landBiome(t, p, nn));
    else b = landBiome(t, p, nn);
    if (b !== Biome.SnowPeak && b !== Biome.Mountain && e < 0.06 && p > 0.62 && t > 0.35 && wetNear(x, y, w, h, flags)) b = Biome.Swamp;
    biome[i] = b;
  }
}
function landBiome(t: number, p: number, n: number): number {
  /* noisy borders, so biomes interfinger instead of nesting in rings */
  t += n * 0.06; p += n * 0.16;
  if (t < 0.1) return Biome.IceSheet;
  if (t < 0.22) return Biome.Tundra;
  if (t < 0.42) return p > 0.34 ? Biome.Taiga : p > 0.16 ? Biome.ColdSteppe : Biome.ColdDesert;
  if (t < 0.7) return p < 0.14 ? Biome.ColdDesert : p < 0.3 ? Biome.Grassland : p < 0.42 ? Biome.Shrubland : p < 0.72 ? Biome.TemperateForest : Biome.TemperateRainforest;
  return p < 0.15 ? Biome.HotDesert : p < 0.33 ? Biome.Savanna : p < 0.56 ? Biome.TropicalForest : Biome.Rainforest;
}
function wetNear(x: number, y: number, w: number, h: number, flags: Uint8Array) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; if (flags[yy * w + xx] & (Flag.River | Flag.Lake)) return true; }
  return false;
}

/*
  Forests grow in groves with clearings between them. Which species grows where depends on
  climate, then on slow noise so you get stands of birch, patches of maple, a dark spruce
  wood on the north slope, willows along the water.
*/
export function vegetation(w: number, h: number, elev: Float32Array, temp: Float32Array, _rain: Float32Array, biome: Uint8Array, flags: Uint8Array, seed: number, tree: Uint8Array, progress: (p: number) => void) {
  const S = h;
  const DENS: Record<number, number> = {
    [Biome.TemperateForest]: 0.8, [Biome.TemperateRainforest]: 0.9, [Biome.Taiga]: 0.72, [Biome.Rainforest]: 0.93, [Biome.TropicalForest]: 0.72,
    [Biome.Swamp]: 0.55, [Biome.Savanna]: 0.06, [Biome.Grassland]: 0.045, [Biome.Shrubland]: 0.3, [Biome.Tundra]: 0.03, [Biome.ColdSteppe]: 0.025,
    [Biome.HotDesert]: 0.012, [Biome.ColdDesert]: 0.008, [Biome.Beach]: 0.035, [Biome.Mountain]: 0.1, [Biome.Shingle]: 0.005,
  };
  for (let y = 0; y < h; y++) {
    if ((y & 127) === 0) progress(y / h);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, b = biome[i]; const base = DENS[b]; if (!base) continue;
      const qx = x / S, qy = y / S;
      const grove = fbm(qx * 28, qy * 28, seed + 101, 4);
      const forested = base > 0.5;
      const d = forested ? base * Math.min(1, Math.max(0, (grove - 0.28) * 3.2)) : base * (0.4 + grove * 1.4);
      const r = hash2(x, y, seed + 7);
      if (r >= d) { if (flags[i] & Flag.Coast || b === Biome.Swamp) { if (nearWater(x, y, w, h, flags) && hash2(x, y, seed + 9) < 0.35) tree[i] = Tree.Reeds; } continue; }
      const t = temp[i], e = elev[i];
      /* stands are led by one species but mixed: neighbors bleed across the edges and strays grow inside */
      const mixA = fbm(qx * 18, qy * 18, seed + 111, 3) + (hash2(x, y, seed + 17) - 0.5) * 0.26 + (hash2(x, y, seed + 19) < 0.1 ? hash2(y, x, seed + 23) - 0.5 : 0);
      const mixB = fbm(qx * 40, qy * 40, seed + 121, 2), pick = hash2(x, y, seed + 13);
      let s: number = Tree.None;
      switch (b) {
        case Biome.TemperateForest:
          if (nearWater(x, y, w, h, flags) && pick < 0.45) s = Tree.Willow;
          else if (t < 0.5) s = mixA < 0.35 ? Tree.Birch : mixA < 0.55 ? Tree.Aspen : mixA < 0.75 ? Tree.Spruce : Tree.Pine;
          else s = mixA < 0.28 ? Tree.Oak : mixA < 0.42 ? Tree.Beech : mixA < 0.58 ? Tree.Maple : mixA < 0.7 ? Tree.Birch : mixA < 0.8 ? Tree.Aspen : mixB < 0.5 ? Tree.Oak : Tree.Pine;
          if (pick > 0.985) s = Tree.Snag; else if (pick > 0.95) s = Tree.BerryBush;
          break;
        case Biome.TemperateRainforest: s = mixA < 0.45 ? Tree.Fir : mixA < 0.7 ? Tree.Spruce : mixA < 0.85 ? Tree.Maple : Tree.Cypress; break;
        case Biome.Taiga: s = mixA < 0.35 ? Tree.Spruce : mixA < 0.6 ? Tree.Fir : mixA < 0.78 ? Tree.Pine : mixA < 0.9 ? Tree.Larch : Tree.Birch; if (pick > 0.98) s = Tree.Snag; break;
        case Biome.Rainforest: s = (flags[i] & Flag.Coast) && pick < 0.6 ? Tree.Mangrove : mixA < 0.7 ? Tree.Jungle : Tree.Palm; break;
        case Biome.TropicalForest: s = mixA < 0.55 ? Tree.Jungle : mixA < 0.75 ? Tree.Palm : Tree.Acacia; break;
        case Biome.Swamp: s = t > 0.7 ? Tree.Mangrove : pick < 0.5 ? Tree.Cypress : Tree.Willow; break;
        case Biome.Savanna: s = pick < 0.12 ? Tree.Baobab : Tree.Acacia; break;
        case Biome.Grassland: s = pick < 0.35 ? Tree.BerryBush : t < 0.5 ? Tree.Birch : mixA < 0.5 ? Tree.Oak : Tree.Maple; break;
        case Biome.Shrubland: s = pick < 0.25 ? Tree.BerryBush : pick < 0.85 ? Tree.Shrub : Tree.Pine; break;
        case Biome.Tundra: case Biome.ColdSteppe: s = pick < 0.6 ? Tree.Shrub : Tree.Larch; break;
        case Biome.HotDesert: s = pick < 0.75 ? Tree.Cactus : Tree.Snag; break;
        case Biome.ColdDesert: s = Tree.Snag; break;
        case Biome.Beach: s = t > 0.62 ? Tree.Palm : Tree.Shrub; break;
        case Biome.Shingle: s = Tree.Shrub; break;
        case Biome.Mountain: s = e > 0.55 ? Tree.Snag : t > 0.6 ? Tree.Pine : mixA < 0.5 ? Tree.Spruce : Tree.Pine; break;
      }
      tree[i] = s;
    }
  }
}
function nearWater(x: number, y: number, w: number, h: number, flags: Uint8Array) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; if (flags[yy * w + xx] & Flag.Water) return true; }
  return false;
}
