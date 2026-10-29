import { Flag, DAY_SECONDS, DAYS_PER_YEAR, type WorldData } from "../shared/types.ts";
import { fbm } from "../shared/noise.ts";
import { CELL } from "./ecology.ts";

/*
  The weather as the land feels it: how much water the soil of each patch holds, filled by
  the rain of its climate and the season, emptied by the heat. Over it runs the slow swing
  of wet and dry years, a seeded noise over place and time, so that a region can go dry
  for a season or two, or a few years, and come back: a drought is never a date, only a
  stretch of the swing where the rain fell short. Rivers and lakes never dry.
*/

/** How much of a patch's rain falls in each season: spring wet, summer dry. */
const SEASON = [1.1, 0.7, 0.9, 1.0];
/** How fast rain fills the soil, and how fast heat empties it. */
const FILL = 0.06, EVAP = 0.012, EVAP_HEAT = 0.0009;
/** The swing of the years: a region's rain runs between these shares of its usual. */
const YEAR_LOW = 0.55, YEAR_SPAN = 0.8;
/** Below this share of the usual rain, for a season or more, the land is in drought. */
export const DROUGHT = 0.75;

export class Weather {
  readonly gw: number; readonly gh: number;
  /** soil moisture per patch, 0..1 */
  moist: Float32Array;
  /** the rain a patch gets in a usual year, 0..1, and its mean temperature in degrees */
  readonly rainK: Float32Array; readonly tempC: Float32Array;
  /** the year's swing per patch, as of the last day */
  factor: Float32Array;
  /** where each patch's soil settles in an ordinary year: what the land is used to, and grows by */
  readonly normal: Float32Array;
  stats = { droughtDays: 0 };
  private readonly seed: number;
  constructor(w: WorldData, seed: number) {
    this.seed = seed;
    const gw = this.gw = Math.ceil(w.w / CELL), gh = this.gh = Math.ceil(w.h / CELL), n = gw * gh;
    this.rainK = new Float32Array(n); this.tempC = new Float32Array(n); this.moist = new Float32Array(n); this.factor = new Float32Array(n).fill(1); this.normal = new Float32Array(n);
    const cnt = new Float32Array(n);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const i = y * w.w + x; if (w.flags[i] & Flag.Water) continue;
      const c = ((y / CELL) | 0) * gw + ((x / CELL) | 0);
      cnt[c]++; this.rainK[c] += w.rain[i] / 255; this.tempC[c] += w.temp[i] / 255 * 62 - 26;
    }
    for (let c = 0; c < n; c++) {
      if (cnt[c]) { this.rainK[c] /= cnt[c]; this.tempC[c] /= cnt[c]; } else { this.rainK[c] = 0.5; this.tempC[c] = 10; }
      /* the soil starts where its climate would leave it, in an ordinary year */
      this.normal[c] = this.settled(c, 1); this.moist[c] = this.normal[c];
    }
  }
  private settled(c: number, factor: number): number { return Math.max(0.02, Math.min(1, FILL * this.rainK[c] * factor / (EVAP + EVAP_HEAT * Math.max(0, this.tempC[c] - 10)))); }
  cellOf(x: number, y: number): number { return Math.min(this.gh - 1, Math.max(0, (y / CELL) | 0)) * this.gw + Math.min(this.gw - 1, Math.max(0, (x / CELL) | 0)); }
  moistAt(x: number, y: number): number { return this.moist[this.cellOf(x, y)]; }
  /** How wet a patch is against what it is used to: 1 in an ordinary year, less in a dry one, a little more in a wet one. */
  wetness(c: number): number { return Math.min(1.15, this.moist[c] / Math.max(0.02, this.normal[c])); }
  wetnessAt(x: number, y: number): number { return this.wetness(this.cellOf(x, y)); }
  /** How this patch's year is running against the usual, 0.55 wet-dry: a slow, regional, seeded swing, continuous in place and time. */
  yearFactor(c: number, t: number): number {
    const cx = c % this.gw, cy = (c / this.gw) | 0;
    const u = cx * CELL / 160, v = cy * CELL / 160, yr = t / (DAY_SECONDS * DAYS_PER_YEAR);
    const n = fbm(u * 0.7 + yr * 0.9, v * 0.7 + yr * 0.37, this.seed + 401, 3);
    return YEAR_LOW + YEAR_SPAN * Math.max(0, Math.min(1, (n - 0.5) * 2.4 + 0.5));
  }
  /** Whether a patch is in drought now: the year dry, and the soil gone dry with it. */
  droughtAt(c: number): boolean { return this.factor[c] < DROUGHT && this.moist[c] < 0.25; }
  /** Once a game day: rain by climate, season and the year's swing fills the soil; the heat empties it. */
  daily(time: number, season: number): void {
    let dry = 0;
    for (let c = 0; c < this.moist.length; c++) {
      const f = this.yearFactor(c, time); this.factor[c] = f;
      const rain = FILL * this.rainK[c] * SEASON[season] * f, evap = (EVAP + EVAP_HEAT * Math.max(0, this.tempC[c] - 10)) * this.moist[c];
      this.moist[c] = Math.max(0.02, Math.min(1, this.moist[c] + rain - evap));
      if (this.droughtAt(c)) dry++;
    }
    this.stats.droughtDays += dry;
  }
  /** Soil moisture per patch, 0..255, for the page. */
  snapshot(): Uint8Array { const out = new Uint8Array(this.moist.length); for (let c = 0; c < out.length; c++) out[c] = Math.round(this.moist[c] * 255); return out; }
  /** How many patches are in drought now, and the mean moisture of the land. */
  summary(): { drought: number; mean: number } { let d = 0, m = 0; for (let c = 0; c < this.moist.length; c++) { if (this.droughtAt(c)) d++; m += this.moist[c]; } return { drought: d, mean: m / Math.max(1, this.moist.length) }; }
}
