import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { personDetail, bandDetail } from "../src/sim/people/inspect.ts";
import { Goal, Place } from "../src/sim/people/person.ts";
import { BLOCKED, Walker } from "../src/sim/people/walk.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, Flag, type WorldData } from "../src/shared/types.ts";

/* One medium world, shared: making it and settling its wildlife is the slow part. */
const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(start: "bands" | "cradle", bands: number) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 4, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start, bands }, t0);
  let time = t0, lastDay = -1;
  const run = (years: number, dt = 2) => {
    const end = time + years * 40 * DAY_SECONDS;
    while (time < end) {
      time += dt;
      const season = Math.floor(time / DAY_SECONDS / DAYS_PER_SEASON) % 4, day = Math.floor(time / DAY_SECONDS);
      wild.update(dt, season, day);
      if (day !== lastDay) { lastDay = day; eco.daily(season); }
      s.update(dt, time, season);
    }
  };
  return { s, run, wild };
}

describe("getting around on foot", () => {
  it("finds a way wherever the ground joins up, and never across open water", () => {
    const wk = new Walker(world);
    let asked = 0, found = 0, split = 0;
    for (const season of [1, 3]) {
      wk.setSeason(season);
      for (let k = 0, n = 0; n < 500 && k < 40000; k++) {
        const x = 20 + (k * 7919) % (world.w - 40), y = 20 + (k * 104729) % (world.h - 40);
        const a = (k * 0.618) % 1 * Math.PI * 2, d = 12 + (k * 31) % 60, gx = x + Math.cos(a) * d, gy = y + Math.sin(a) * d;
        if (!wk.dry(x + 0.5, y + 0.5) || !wk.dry(gx, gy)) continue;
        if (!wk.reach(x + 0.5, y + 0.5, gx, gy)) { split++; expect(wk.route(x + 0.5, y + 0.5, gx, gy, 40000)).toBeNull(); continue; }
        asked++; n++;
        const r = wk.route(x + 0.5, y + 0.5, gx, gy, 40000, true);
        if (r) { found++; for (let i = 0; i < r.length; i += 2) expect(wk.at(r[i], r[i + 1])).toBeLessThan(BLOCKED); }
      }
    }
    expect(asked).toBe(1000);
    expect(split).toBeGreaterThan(4);
    expect(found).toBe(asked);
  });
});

describe("people: founding", () => {
  const { s } = fresh("bands", 8);
  it("founds the bands asked for, on dry land beside fresh water", () => {
    expect(s.bands.length).toBe(8);
    for (const b of s.bands) {
      expect(s.walker.dry(b.x, b.y)).toBe(true);
      expect(s.waterNear(b.x, b.y, 8)).not.toBeNull();
      expect(b.members.length).toBeGreaterThanOrEqual(12);
    }
  });
  it("peoples of two bands share a culture, and different peoples do not", () => {
    const byCulture = new Map<number, number>();
    for (const b of s.bands) byCulture.set(b.culture, (byCulture.get(b.culture) ?? 0) + 1);
    expect(byCulture.size).toBe(4);
    for (const n of byCulture.values()) expect(n).toBe(2);
  });
  it("families are real: children carry their parents' genes, couples are not close kin", () => {
    let checked = 0;
    for (const p of s.people) {
      const m = s.byId.get(p.mother), f = s.byId.get(p.father);
      if (m && f) {
        /* one copy from each parent at every locus, apart from the odd mutation */
        checked++;
        let odd = 0;
        for (let l = 0; l < p.genome.length / 2; l++) {
          if (m.genome[l * 2] !== p.genome[l * 2] && m.genome[l * 2 + 1] !== p.genome[l * 2]) odd++;
          if (f.genome[l * 2] !== p.genome[l * 2 + 1] && f.genome[l * 2 + 1] !== p.genome[l * 2 + 1]) odd++;
        }
        expect(odd).toBeLessThanOrEqual(3);
      }
      const q = s.byId.get(p.partner);
      if (q) expect(s.kin(p, q, 1)).toBe(false);
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe("people: a few years of life", () => {
  const { s, run } = fresh("bands", 8);
  const start = s.people.length;
  run(3);

  it("people are born and die, and the bands carry on", () => {
    expect(s.stats.births).toBeGreaterThan(10);
    expect(s.stats.deaths).toBeGreaterThan(5);
    expect(s.people.length).toBeGreaterThan(start * 0.6);
    expect(s.bands.length).toBeGreaterThanOrEqual(5);
  });
  it("nobody is lost in the water or off the map", () => {
    for (const p of s.people) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(s.walker.at(p.x, p.y)).toBeLessThan(BLOCKED);
    }
  });
  it("everyone awake has a reason for what they are doing", () => {
    for (const p of s.people) if (!p.carrier && p.goal !== Goal.None) expect(p.why.length).toBeGreaterThan(10);
  });
  it("new couples form, and never between close kin", () => {
    expect(s.stats.couples).toBeGreaterThan(2);
    for (const p of s.people) { const q = s.byId.get(p.partner); if (q) { expect(q.partner).toBe(p.id); expect(s.kin(p, q, 1)).toBe(false); } }
  });
  it("hunters kill real animals from the herds, and gatherers and fishers bring food in", () => {
    expect(s.stats.kills.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
    expect(s.stats.food.plant).toBeGreaterThan(500);
    expect(s.stats.food.meat).toBeGreaterThan(200);
  });
  it("news travels by talk: people know places only others have seen", () => {
    const told = s.people.filter(p => p.places.some(pl => pl.src !== 0)).length;
    expect(told).toBeGreaterThan(s.people.length * 0.2);
  });
  it("bands move camp when the land around them is used up", () => {
    expect(s.stats.moves).toBeGreaterThan(3);
  });
  it("the inspector can describe anyone and any band in words", () => {
    const p = s.people.find(q => s.age(q) > 20)!;
    const d = personDetail(s, p.id)!;
    expect(d.name).toBe(p.name);
    expect(d.why.length).toBeGreaterThan(10);
    expect(d.looks).toMatch(/skin/);
    expect(d.traits.length).toBe(3);
    const b = bandDetail(s, s.bands[0].id)!;
    expect(b.members.length).toBe(s.bands[0].members.length);
  });
  it("tells its stories: births, deaths and couples make the news", () => {
    const kinds = new Set(s.events.map(e => e.kind));
    for (const k of ["birth", "death", "couple"]) expect(kinds.has(k)).toBe(true);
  });
});

describe("people: determinism and the cradle start", () => {
  it("the same seed lives the same life", () => {
    const a = fresh("bands", 4), b = fresh("bands", 4);
    a.run(0.3); b.run(0.3);
    expect(a.s.people.length).toBe(b.s.people.length);
    const sig = (s: Society) => s.people.map(p => `${p.id}:${p.x.toFixed(3)},${p.y.toFixed(3)}:${p.goal}`).join("|");
    expect(sig(a.s)).toBe(sig(b.s));
  });
  it("a cradle start is one people, all near one homeland", () => {
    const { s } = fresh("cradle", 6);
    expect(new Set(s.bands.map(b => b.culture)).size).toBe(1);
    const cx = s.bands[0].x, cy = s.bands[0].y;
    for (const b of s.bands) expect(Math.hypot(b.x - cx, b.y - cy)).toBeLessThan(130);
    /* they know each other's camps */
    const p = s.people.find(q => s.age(q) > 20)!;
    expect(p.places.filter(pl => pl.k === Place.Camp && pl.ref !== p.band).length).toBeGreaterThan(0);
  });
});

describe("the rule: nothing is triggered by a date", () => {
  it("no simulation code fires events on a particular year or day", () => {
    const dir = "src/sim/people/";
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, "utf8");
      expect(src).not.toMatch(/\b(year|day)\s*===?\s*\d/);
      expect(src).not.toMatch(/\btime\s*[<>]=?\s*\d{3,}/);
    }
    void Flag;
  });
});
