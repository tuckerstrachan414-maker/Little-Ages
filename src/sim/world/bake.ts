import { Biome, Flag, DECIDUOUS, CONIFER, type MapMode, type Season, type WorldData } from "../../shared/types.ts";
import { FN, CANOPY, hex2rgb } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import { vnoise } from "../../shared/noise.ts";
import { isSnowy, FREEZE_T } from "../../shared/seasonfx.ts";
import { MAT_COLORS } from "../../shared/mats.ts";

/*
  Paints one pixel per tile. Land gets its biome color, a canopy texture where trees grow,
  and hillshade lit from the northwest so ranges and valleys read in relief. Water is
  banded by depth. Each season repaints the whole map: autumn turns each tree species its
  own color, winter lays snow wherever it's cold enough.
*/

type RGB = [number, number, number];
const C = (h: string): RGB => hex2rgb(h);
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BASE: Record<number, string> = {
  [Biome.Beach]: FN.sand, [Biome.Shingle]: FN.shingle, [Biome.Cliff]: FN.cliff, [Biome.IceSheet]: FN.iceSheet, [Biome.Tundra]: FN.tundra,
  [Biome.Taiga]: FN.taiga, [Biome.ColdSteppe]: FN.steppe, [Biome.ColdDesert]: FN.coldDesert, [Biome.Grassland]: FN.grass, [Biome.Shrubland]: FN.shrub,
  [Biome.TemperateForest]: FN.forest, [Biome.TemperateRainforest]: FN.rainforest, [Biome.Savanna]: FN.savanna, [Biome.HotDesert]: FN.desert,
  [Biome.TropicalForest]: FN.forest, [Biome.Rainforest]: FN.rainforest, [Biome.Swamp]: FN.swamp, [Biome.Mountain]: FN.rock, [Biome.SnowPeak]: FN.snow,
};
const BIOME_FLAT: Record<number, string> = { ...BASE, [Biome.DeepOcean]: FN.deep, [Biome.Ocean]: FN.ocean, [Biome.Shelf]: FN.shelf, [Biome.Lake]: FN.lake, [Biome.River]: FN.river };

/* Sea color for any point, including points between tile centers (the close-up ground uses
   it to draw smooth depth contours). `depthV` is the distance to land in tiles. */
const SEA = { deep: C(FN.deep), ocean: C(FN.ocean), shelf: C(FN.shelf), shallow: C(FN.shallow), ice: C(FN.ice) };
const BANDS = { d1: lerp(SEA.shelf, SEA.ocean, 0.55), d2: lerp(SEA.ocean, SEA.deep, 0.55) };
export const seaOut = { ice: false };
const seaTmp: RGB = [0, 0, 0];
export function seaColor(x: number, y: number, depthV: number, shelfBiome: boolean, t8: number, season: Season, seed: number): RGB {
  const { deep, ocean, shelf, shallow, ice } = SEA;
  /* OpenFront-style depth bands with a dithered seam between them */
  const d = depthV + (vnoise(x / 4, y / 4, seed + 8) - 0.5) * 3;
  let c = d <= 2 ? shallow : d <= 6 ? shelf : d <= 14 ? BANDS.d1 : d <= 30 ? ocean : d <= 60 ? BANDS.d2 : deep;
  const coldness = ((season === 3 ? 44 : 26) - t8) / 26;
  seaOut.ice = coldness > 0 && vnoise(x / 9, y / 9, seed + 9) * 0.7 + vnoise(x / 3, y / 3, seed + 10) * 0.3 < 0.35 + coldness * 0.5;
  if (!(shelfBiome && d > 6) && !seaOut.ice) return c;
  if (shelfBiome && d > 6) { seaTmp[0] = c[0] + (shelf[0] - c[0]) * 0.35; seaTmp[1] = c[1] + (shelf[1] - c[1]) * 0.35; seaTmp[2] = c[2] + (shelf[2] - c[2]) * 0.35; c = seaTmp; }
  if (seaOut.ice) { seaTmp[0] = c[0] + (ice[0] - c[0]) * 0.82; seaTmp[1] = c[1] + (ice[1] - c[1]) * 0.82; seaTmp[2] = c[2] + (ice[2] - c[2]) * 0.82; c = seaTmp; }
  return c;
}

/** Extra layers the worker paints into some modes: the deposits and who knows of them, for the "resources" mode. */
export interface BakeExtra { deposits: { kind: number; x: number; y: number; r: number; amount: number; left: number; knownBy: number }[]; colors: string[]; moist?: Float32Array; cell?: number; gw?: number; }

const PAL = {
  shallow: C(FN.shallow), lake: C(FN.lake), river: C(FN.river), ice: C(FN.ice),
  snow: C(FN.snow), snowD: C(FN.snowD), rock: C(FN.rock), rockL: C(FN.rockL), dry: C(FN.dryGrass), grassL: C(FN.grassL),
  base: {} as Record<number, RGB>, flat: {} as Record<number, RGB>, canopy: {} as Record<number, RGB[]>,
  /* the resources mode: bare ground, standing wood, a dead tree, high ground, flat water */
  bare: [190, 176, 142] as RGB, wood: [96, 138, 88] as RGB, snag: [150, 136, 112] as RGB, high: [168, 164, 156] as RGB, water: [122, 150, 160] as RGB,
};
for (const k in BASE) PAL.base[+k] = C(BASE[+k]);
for (const k in BIOME_FLAT) PAL.flat[+k] = C(BIOME_FLAT[+k]);
for (const k in CANOPY) PAL.canopy[+k] = CANOPY[+k].map(C);

/** The color of one tile in a mode and season: the terrain itself, or a map of one thing about it. */
export function tileColor(wd: WorldData, season: Season, mode: MapMode, i: number, extra?: BakeExtra): RGB {
  const { w, h, elev, biome, flags, tree, temp, rain, depth, seed } = wd;
  const x = i % w, y = (i / w) | 0, e = elev[i], f = flags[i], b = biome[i];
  const { shallow, lake, river, ice, snow, snowD, rock, rockL, dry, grassL, base, flat, canopy } = PAL;
  const freezeT = FREEZE_T[season];
  if (mode === "dryness") {
    if (f & Flag.Water) return PAL.water;
    const m = extra?.moist && extra.cell && extra.gw ? extra.moist[((y / extra.cell) | 0) * extra.gw + ((x / extra.cell) | 0)] : 0.6;
    const c = m < 0.35 ? lerp([196, 160, 104] as RGB, [214, 200, 150] as RGB, m / 0.35) : lerp([214, 200, 150] as RGB, [80, 130, 90] as RGB, (m - 0.35) / 0.65);
    const ex = (x < w - 1 ? elev[i + 1] : e) - (x > 0 ? elev[i - 1] : e), ey = (y < h - 1 ? elev[i + w] : e) - (y > 0 ? elev[i - w] : e);
    const k = 1 + Math.max(-1, Math.min(1, -(ex + ey) * 9)) * 0.18;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  if (mode === "resources") {
    if (f & Flag.Water) return PAL.water;
    let c: RGB = b === Biome.Mountain || b === Biome.SnowPeak || b === Biome.IceSheet || b === Biome.Cliff ? PAL.high : PAL.bare;
    const tr = tree[i];
    if (tr === 17) c = PAL.snag;
    else if (tr) c = lerp(c, PAL.wood, tr === 18 || tr === 20 ? 0.35 : tr === 19 || tr === 16 ? 0.25 : 0.85);
    const ex = (x < w - 1 ? elev[i + 1] : e) - (x > 0 ? elev[i - 1] : e), ey = (y < h - 1 ? elev[i + w] : e) - (y > 0 ? elev[i - w] : e);
    const k = 1 + Math.max(-1, Math.min(1, -(ex + ey) * 9)) * 0.18;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  if (mode !== "terrain") return modeColor(mode, b, e, temp[i], rain[i], flat);
  if (f & Flag.Ocean) return seaColor(x, y, depth[i], b === Biome.Shelf, temp[i], season, seed);
  if (f & Flag.Lake) return temp[i] / 255 < freezeT ? ice : lake;
  if (f & Flag.River) return temp[i] / 255 < freezeT ? lerp(ice, river, 0.25) : lerp(river, lake, (depth[i] - 1) * 0.3);
  const t = temp[i] / 255;
  let c = base[b] ?? base[Biome.Grassland];
  /* grass browns in dry places and in autumn, greens up in spring */
  if (b === Biome.Grassland || b === Biome.Shrubland || b === Biome.Savanna || b === Biome.ColdSteppe) {
    const dryness = Math.max(0, 0.45 - rain[i] / 255) * 1.5 + (season === 2 ? 0.28 : season === 1 ? 0.08 : 0);
    c = lerp(c, dry, Math.min(0.7, dryness));
    if (season === 0) c = lerp(c, grassL, 0.18);
  }
  /* tree canopies, lit on their northwest side */
  const tr = tree[i];
  if (tr) {
    const s = season === 3 && CONIFER.has(tr) ? 3 : season;
    let cc = canopy[tr][s];
    const hl = hash2(x, y, seed + 3);
    const lit = hl < 0.3 ? 1.12 : hl > 0.82 ? 0.84 : 1;
    cc = [cc[0] * lit, cc[1] * lit, cc[2] * lit];
    if (season === 0 && DECIDUOUS.has(tr) && hl > 0.93) cc = [236, 196, 208];   /* blossom */
    c = lerp(c, cc, tr === 19 || tr === 20 || tr === 18 ? 0.55 : 0.82);
  }
  /* altitude: rock shows through high up, then snow */
  if (b === Biome.Mountain) c = lerp(c, e > 0.45 ? rockL : rock, 0.35);
  if (isSnowy(t, b, season, hash2(x, y, seed + 5))) {
    const keepTree = tr && CONIFER.has(tr) && hash2(x, y, seed + 6) < 0.6;
    c = keepTree ? lerp(c, snow, 0.35) : lerp(snowD, snow, hash2(x, y, seed + 4) < 0.5 ? 1 : 0.7);
  }
  /* hillshade: light from the northwest */
  const ex = (x < w - 1 ? elev[i + 1] : e) - (x > 0 ? elev[i - 1] : e);
  const ey = (y < h - 1 ? elev[i + w] : e) - (y > 0 ? elev[i - w] : e);
  const sh = Math.max(-1, Math.min(1, -(ex + ey) * 9));
  const k = 1 + sh * 0.32 + e * 0.12;
  c = sh < 0 ? [c[0] * k * 0.98, c[1] * k * 0.99, c[2] * k * 1.06] : [c[0] * k * 1.03, c[1] * k * 1.01, c[2] * k * 0.96];
  /* wet sand darkens right at the waterline */
  if ((b === Biome.Beach || b === Biome.Shingle) && (f & Flag.Coast) && e < 0.004) c = lerp(c, shallow, 0.25);
  return c;
}

export function bake(wd: WorldData, season: Season, mode: MapMode = "terrain", out?: Uint8ClampedArray, extra?: BakeExtra): Uint8ClampedArray {
  const { w, h } = wd;
  const px = out ?? new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = tileColor(wd, season, mode, i, extra), o = i * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  if (mode === "resources" && extra) paintDeposits(wd, px, extra);
  return px;
}

/** Repaints one tile after its tree changed, in place. */
export function bakeTile(wd: WorldData, season: Season, mode: MapMode, i: number, px: Uint8ClampedArray): void {
  const c = tileColor(wd, season, mode, i), o = i * 4;
  px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
}

/** Each deposit as a soft disc in its material's color, darkened as it is dug out, ringed in the colors of the peoples who know of it. */
function paintDeposits(wd: WorldData, px: Uint8ClampedArray, extra: BakeExtra): void {
  const { w, h } = wd;
  const dark: RGB = [40, 34, 30];
  const colors = extra.colors.map(C);
  for (const d of extra.deposits) {
    const mat = C(MAT_COLORS[d.kind] ?? "#ffffff"), dug = 1 - d.left / Math.max(1, d.amount);
    const fill = lerp(mat, dark, dug * 0.65), R = d.r + 1.2;
    const knowers: number[] = []; for (let k = 0; k < colors.length; k++) if (d.knownBy & (1 << k)) knowers.push(k);
    for (let y = Math.max(0, Math.floor(d.y - R - 1)); y <= Math.min(h - 1, Math.ceil(d.y + R + 1)); y++) for (let x = Math.max(0, Math.floor(d.x - R - 1)); x <= Math.min(w - 1, Math.ceil(d.x + R + 1)); x++) {
      const dx = x + 0.5 - d.x, dy = y + 0.5 - d.y, dist = Math.hypot(dx, dy);
      if (dist > R) continue;
      const o = (y * w + x) * 4;
      let c: RGB, a: number;
      if (dist <= d.r) { c = fill; a = dist < d.r * 0.5 ? 0.92 : 0.7; }
      else if (knowers.length) { const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1; c = colors[knowers[Math.floor(ang * knowers.length) % knowers.length]]; a = 0.95; }
      else continue;
      px[o] = px[o] + (c[0] - px[o]) * a; px[o + 1] = px[o + 1] + (c[1] - px[o + 1]) * a; px[o + 2] = px[o + 2] + (c[2] - px[o + 2]) * a;
    }
  }
}

function modeColor(mode: MapMode, b: number, e: number, t8: number, r8: number, flat: Record<number, RGB>): RGB {
  if (mode === "biomes") return flat[b] ?? [255, 0, 255];
  if (e < 0 && mode !== "temperature") return lerp([28, 52, 70], [70, 120, 135], 1 + e);
  if (mode === "elevation") { const v = Math.max(0, e); return v < 0.25 ? lerp([96, 128, 74], [178, 170, 110], v * 4) : v < 0.6 ? lerp([178, 170, 110], [140, 112, 86], (v - 0.25) / 0.35) : lerp([140, 112, 86], [240, 240, 236], (v - 0.6) / 0.4); }
  if (mode === "temperature") { const t = t8 / 255; return t < 0.5 ? lerp([64, 96, 170], [230, 226, 200], t * 2) : lerp([230, 226, 200], [196, 72, 48], (t - 0.5) * 2); }
  const r = r8 / 255; return r < 0.5 ? lerp([196, 160, 104], [120, 160, 80], r * 2) : lerp([120, 160, 80], [48, 100, 150], (r - 0.5) * 2);
}
