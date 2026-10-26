import { Biome, Flag, DECIDUOUS, CONIFER, type MapMode, type Season, type WorldData } from "../../shared/types.ts";
import { FN, CANOPY, hex2rgb } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import { vnoise } from "../../shared/noise.ts";
import { isSnowy, FREEZE_T } from "../../shared/seasonfx.ts";

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

export function bake(wd: WorldData, season: Season, mode: MapMode = "terrain", out?: Uint8ClampedArray): Uint8ClampedArray {
  const { w, h, elev, biome, flags, tree, temp, rain, depth, seed } = wd;
  const px = out ?? new Uint8ClampedArray(w * h * 4);
  const shallow = C(FN.shallow), lake = C(FN.lake), river = C(FN.river), ice = C(FN.ice);
  const snow = C(FN.snow), snowD = C(FN.snowD), rock = C(FN.rock), rockL = C(FN.rockL), dry = C(FN.dryGrass), grassL = C(FN.grassL);
  const base: Record<number, RGB> = {}; for (const k in BASE) base[+k] = C(BASE[+k]);
  const flat: Record<number, RGB> = {}; for (const k in BIOME_FLAT) flat[+k] = C(BIOME_FLAT[+k]);
  const canopy: Record<number, RGB[]> = {}; for (const k in CANOPY) canopy[+k] = CANOPY[+k].map(C);
  const freezeT = FREEZE_T[season];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4, e = elev[i], f = flags[i], b = biome[i];
    let c: RGB;
    if (mode !== "terrain") c = modeColor(mode, b, e, temp[i], rain[i], flat);
    else if (f & Flag.Ocean) {
      c = seaColor(x, y, depth[i], b === Biome.Shelf, temp[i], season, seed);
    } else if (f & Flag.Lake) {
      c = temp[i] / 255 < freezeT ? ice : lake;
    } else if (f & Flag.River) {
      c = temp[i] / 255 < freezeT ? lerp(ice, river, 0.25) : lerp(river, lake, (depth[i] - 1) * 0.3);
    } else {
      const t = temp[i] / 255;
      c = base[b] ?? base[Biome.Grassland];
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
    }
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return px;
}

function modeColor(mode: MapMode, b: number, e: number, t8: number, r8: number, flat: Record<number, RGB>): RGB {
  if (mode === "biomes") return flat[b] ?? [255, 0, 255];
  if (e < 0 && mode !== "temperature") return lerp([28, 52, 70], [70, 120, 135], 1 + e);
  if (mode === "elevation") { const v = Math.max(0, e); return v < 0.25 ? lerp([96, 128, 74], [178, 170, 110], v * 4) : v < 0.6 ? lerp([178, 170, 110], [140, 112, 86], (v - 0.25) / 0.35) : lerp([140, 112, 86], [240, 240, 236], (v - 0.6) / 0.4); }
  if (mode === "temperature") { const t = t8 / 255; return t < 0.5 ? lerp([64, 96, 170], [230, 226, 200], t * 2) : lerp([230, 226, 200], [196, 72, 48], (t - 0.5) * 2); }
  const r = r8 / 255; return r < 0.5 ? lerp([196, 160, 104], [120, 160, 80], r * 2) : lerp([120, 160, 80], [48, 100, 150], (r - 0.5) * 2);
}
