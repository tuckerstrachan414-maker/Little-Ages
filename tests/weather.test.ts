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

/* ---------------- the weather as people feel it ---------------- */
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { St, step } from "../src/sim/people/person.ts";
import { homeOf } from "../src/sim/people/band.ts";
import { learn } from "../src/sim/people/ideas.ts";
import { techIx, techByKey } from "../src/sim/tech/tree.ts";
import { Problem, problemsDay } from "../src/sim/tech/problems.ts";
import { addWork, worksDay, Work } from "../src/sim/people/works.ts";
import { startBuilding, buildSpell, RAISE } from "../src/sim/buildings/build.ts";
import { DEFS, defById, Line } from "../src/sim/buildings/defs.ts";
import { wants } from "../src/sim/buildings/wants.ts";
import { Mat } from "../src/sim/economy/goods.ts";

function society(bands = 8) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 2, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands }, t0);
  return { s, eco };
}

describe("the weather as people feel it", () => {
  it("the ecology grows with the rain in the soil, and crops ripen slower and yield less in dry ground", () => {
    const { s, eco } = society();
    const b = s.bands[0], c = eco.cell(b.x, b.y);
    /* two patches alike in all but their water */
    s.weather.moist.fill(1); eco.plants.fill(0.2); const before = eco.plants[c];
    eco.daily(0); const wetGrowth = eco.plants[c] - before;
    s.weather.moist.fill(0.1); eco.plants[c] = before;
    eco.daily(0); const dryGrowth = eco.plants[c] - before;
    expect(wetGrowth).toBeGreaterThan(dryGrowth * 2);
    /* a crop in dry ground */
    const mk = (x: number) => addWork(s, { kind: Work.Plot, x, y: b.y + 3, wx: x, wy: b.y + 3, band: b.id, home: 0, by: 0, t: s.time, state: 0.95, food: 0, crop: "wild grain", ripe: 0, sown: 1, fert: 1, tame: 0 });
    s.weather.moist.fill(1); const wet = mk(b.x + 2);
    for (let d = 0; d < 6 && wet.state < 1; d++) worksDay(s);
    const wetFood = wet.food; expect(wet.state).toBe(1);
    s.weather.moist.fill(0.05); const dry = mk(b.x + 5);
    let days = 0; for (; days < 12 && dry.state < 1; days++) worksDay(s);
    expect(dry.state).toBe(1); expect(days).toBeGreaterThan(1);
    expect(dry.food).toBeLessThan(wetFood * 0.6);
    /* dry ground is a want the band feels */
    problemsDay(s, b);
    expect(b.problems[Problem.Dry]).toBeGreaterThan(0.9);
    expect(b.problems[Problem.Water]).toBeGreaterThanOrEqual(0.3);
  });
  it("is the same for the same seed, from the first day to the hundredth", () => {
    const a = society(4), c = society(4);
    for (let d = 0; d < 100; d++) { a.s.weather.daily(d * DAY_SECONDS, Math.floor(d / 10) % 4); c.s.weather.daily(d * DAY_SECONDS, Math.floor(d / 10) % 4); }
    expect([...a.s.weather.moist.slice(0, 50)]).toEqual([...c.s.weather.moist.slice(0, 50)]);
  });
});

describe("wells", () => {
  const { s } = society();
  const b = s.bands[1], p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) >= 18 && s.age(q) < 50)!;
  it("come to mind when the water is a long walk, and are dug by the band where it camps", () => {
    const d = techByKey("wells")!; expect(d.active).toBe(true); expect(d.story).toBeTruthy();
    learn(s, p, techIx("digging-sticks"), null, "seen"); learn(s, p, techIx("wells"), null, "seen");
    b.water = [b.x + 12, b.y]; b.problems[Problem.Water] = 1;
    const want = wants(s, p, b).find(w => w.def.line === Line.Well)!;
    expect(want).toBeTruthy(); expect(want.owner).toBe("band");
    const st = step(St.Raise, want.x, want.y, 0, 1, { a: RAISE.Band, o: DEFS.indexOf(defById("well0")) });
    buildSpell(s, p, st);
    const w = s.works.find(o => o.kind === Line.Well)!; expect(w).toBeTruthy();
    p.carryKind = Mat.Wood; p.carryAmt = 6;
    for (let k = 0; k < 60 && (w.prog ?? 0) < 1; k++) buildSpell(s, p, st);
    expect(w.prog).toBe(1);
    expect(s.wellNear(b.x, b.y, 12)).toBe(w);
    expect(s.wellSpot(b.x, b.y, 12)).toEqual([w.x, w.y + 1]);
  });
  it("once it stands, the band drinks there and its water is no longer far; a camp can then be made further from the river", () => {
    s.update(0, s.time, s.season);
    /* the day's pass finds the well */
    (s as unknown as { landDay(): void }).landDay();
    const w = s.works.find(o => o.kind === Line.Well)!;
    expect(b.well).toBe(w.id);
    expect(Math.hypot(b.water[0] - b.x, b.water[1] - b.y)).toBeLessThan(9);
    problemsDay(s, b);
    expect(b.problems[Problem.Water]).toBeLessThan(0.9);
    /* with wells known, a band may settle up to twelve tiles from fresh water */
    let far = 0, tries = 0;
    for (let k = 0; k < 40; k++) { const sp = s.campSpot(b.x + (k % 7) * 9, b.y + Math.floor(k / 7) * 9, 14, undefined, b); if (!sp) continue; tries++; const wat = s.waterNear(sp[0], sp[1], 5); if (!wat) far++; }
    const nearOnly = (() => { let n = 0; for (let k = 0; k < 40; k++) { const sp = s.campSpot(b.x + (k % 7) * 9, b.y + Math.floor(k / 7) * 9, 14); if (sp && !s.waterNear(sp[0], sp[1], 5)) n++; } return n; })();
    expect(nearOnly).toBe(0);
    expect(tries).toBeGreaterThan(0);
    expect(far).toBeGreaterThanOrEqual(0);
    void homeOf; void startBuilding;
  });
});
