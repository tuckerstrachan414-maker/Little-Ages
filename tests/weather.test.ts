import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Weather, DROUGHT } from "../src/sim/weather.ts";
import { CELL } from "../src/sim/ecology.ts";
import { Biome, DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  The weather: soil that fills with the rain and empties in the heat, and the slow swing of
  wet and dry years, seeded and continuous, never a date.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
const YEAR = DAY_SECONDS * DAYS_PER_SEASON * 4;
const patchOf = (b: number): number => { for (let y = 8; y < world.h - 8; y += CELL) for (let x = 8; x < world.w - 8; x += CELL) if (world.biome[y * world.w + x] === b) return ((y / CELL) | 0) * Math.ceil(world.w / CELL) + ((x / CELL) | 0); return -1; };

describe("the weather", () => {
  it("starts each patch where its climate would leave it: wet forests, dry deserts", () => {
    const w = new Weather(world, SEED);
    const forest = patchOf(Biome.TemperateRainforest), desert = patchOf(Biome.HotDesert), grass = patchOf(Biome.Grassland);
    expect(forest).toBeGreaterThanOrEqual(0); expect(desert).toBeGreaterThanOrEqual(0);
    expect(w.moist[forest]).toBeGreaterThan(0.8);
    expect(w.moist[desert]).toBeLessThan(0.3);
    if (grass >= 0) { expect(w.moist[grass]).toBeGreaterThan(w.moist[desert]); expect(w.moist[grass]).toBeLessThan(w.moist[forest]); }
  });
  it("fills in a wet spring and dries through a hot summer, and never goes to nothing", () => {
    const w = new Weather(world, SEED), grass = patchOf(Biome.Grassland) >= 0 ? patchOf(Biome.Grassland) : patchOf(Biome.Savanna);
    const start = w.moist[grass];
    let t = 0;
    for (let d = 0; d < DAYS_PER_SEASON; d++) { t += DAY_SECONDS; w.daily(t, 0); }
    const spring = w.moist[grass];
    for (let d = 0; d < DAYS_PER_SEASON; d++) { t += DAY_SECONDS; w.daily(t, 1); }
    const summer = w.moist[grass];
    expect(spring).toBeGreaterThan(summer);
    expect(Math.abs(spring - start)).toBeLessThan(0.5);
    for (let c = 0; c < w.moist.length; c++) { expect(w.moist[c]).toBeGreaterThanOrEqual(0.02); expect(w.moist[c]).toBeLessThanOrEqual(1); }
  });
  it("swings between wet and dry years, differently from place to place, the same for the same seed and never on a date", () => {
    const a = new Weather(world, SEED), b = new Weather(world, SEED), other = new Weather(world, SEED + 1);
    const c = patchOf(Biome.Grassland) >= 0 ? patchOf(Biome.Grassland) : 0, far = Math.min(a.moist.length - 1, c + a.gw * 10 + 10);
    const fs: number[] = [];
    for (let y = 0; y < 30; y++) fs.push(a.yearFactor(c, y * YEAR));
    expect(Math.max(...fs)).toBeGreaterThan(1.05); expect(Math.min(...fs)).toBeLessThan(0.85);
    expect(Math.min(...fs)).toBeGreaterThanOrEqual(0.55); expect(Math.max(...fs)).toBeLessThanOrEqual(1.35);
    /* continuous: a day apart, the swing hardly moves */
    expect(Math.abs(a.yearFactor(c, 10 * YEAR) - a.yearFactor(c, 10 * YEAR + DAY_SECONDS))).toBeLessThan(0.02);
    expect(a.yearFactor(c, 10 * YEAR)).toBeCloseTo(b.yearFactor(c, 10 * YEAR), 9);
    expect(fs.some((f, i) => Math.abs(f - other.yearFactor(c, i * YEAR)) > 0.05)).toBe(true);
    expect(fs.some((f, i) => Math.abs(f - a.yearFactor(far, i * YEAR)) > 0.05)).toBe(true);
    /* a drought is a dry year on dry soil */
    let t = 0, droughts = 0;
    for (let d = 0; d < 40 * 20; d++) { t += DAY_SECONDS; a.daily(t, Math.floor(d / DAYS_PER_SEASON) % 4); if (a.summary().drought > 0) droughts++; }
    expect(droughts).toBeGreaterThan(0);
    expect(a.stats.droughtDays).toBeGreaterThan(0);
    expect(DROUGHT).toBeLessThan(1);
    const snap = a.snapshot(); expect(snap.length).toBe(a.moist.length); expect(Math.max(...snap)).toBeLessThanOrEqual(255);
  });
});
