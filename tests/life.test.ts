import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { Birds, Bird } from "../src/sim/birds.ts";
import { settle } from "../src/sim/settle.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, Species, SPECIES_NAMES } from "../src/shared/types.ts";

/* Runs a medium world's wildlife for some years and samples it at the start of each season. */
function run(seed: number, years: number) {
  const world = generateWorld("medium", seed, () => {});
  const eco = new Ecology(world, seed), wild = new Wildlife(world, seed, eco), birds = new Birds(world, seed);
  settle(wild, eco, 8, () => {});
  const counts = () => { const c = new Array(SPECIES_NAMES.length).fill(0); for (const h of wild.herds) c[h.sp] += h.n; return c; };
  const samples: { season: number; counts: number[]; rabbits: number; geeseLat: number }[] = [];
  const seasonAt = (t: number) => Math.floor(t / DAY_SECONDS / DAYS_PER_SEASON) % 4;
  let time = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS, lastDay = -1, last = -1;
  const end = time + years * 4 * DAYS_PER_SEASON * DAY_SECONDS;
  while (time < end) {
    time += 2;
    const s = seasonAt(time), day = Math.floor(time / DAY_SECONDS);
    wild.update(2, s, day); birds.update(2, s);
    if (day !== lastDay) { lastDay = day; eco.daily(s); }
    if (s !== last) {
      last = s;
      const geese = birds.flocks.filter(f => f.kind === Bird.Goose);
      samples.push({ season: s, counts: counts(), rabbits: eco.total().rabbits, geeseLat: geese.reduce((a, f) => a + Math.abs(f.y / world.h - 0.5) * 2, 0) / Math.max(1, geese.length) });
    }
  }
  return samples;
}

describe("wildlife", () => {
  const samples = run(7, 12);

  it("no species dies out on its own, and none runs away", () => {
    const first = samples[0].counts, lastC = samples[samples.length - 1].counts;
    for (let sp = 0; sp < SPECIES_NAMES.length; sp++) {
      if (sp === Species.Dog) { expect(lastC[sp]).toBe(0); continue; }
      expect(lastC[sp]).toBeGreaterThan(0);
      if (first[sp] >= 20) { expect(lastC[sp] / first[sp]).toBeGreaterThan(0.33); expect(lastC[sp] / first[sp]).toBeLessThan(3); }
    }
  });

  it("numbers move with the seasons: young in spring, losses in winter", () => {
    const totals = samples.map(s => s.counts.reduce((a, b) => a + b, 0));
    let springGains = 0, springs = 0;
    for (let k = 1; k < samples.length; k++) if (samples[k - 1].season === 0) { springs++; if (totals[k] > totals[k - 1]) springGains++; }
    expect(springGains).toBeGreaterThanOrEqual(springs - 1);
    expect(new Set(totals).size).toBeGreaterThan(5);
  });

  it("wolves and bears stay rarer than what they hunt", () => {
    const c = samples[samples.length - 1].counts;
    const prey = c[Species.Deer] + c[Species.Aurochs] + c[Species.Horse];
    expect(c[Species.Wolf]).toBeLessThan(prey * 0.2);
    expect(c[Species.Bear]).toBeLessThan(c[Species.Wolf] * 2 + 20);
  });

  it("small game persists", () => {
    for (const s of samples) expect(s.rabbits).toBeGreaterThan(1000);
  });

  it("geese winter nearer the equator than they summer", () => {
    const summer = samples.filter(s => s.season === 1).map(s => s.geeseLat), winter = samples.filter(s => s.season === 0).map(s => s.geeseLat);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(winter)).toBeLessThan(avg(summer));
  });

  it("is deterministic: the same seed lives the same life", () => {
    const a = run(3, 2), b = run(3, 2);
    expect(a.map(s => s.counts.join(","))).toEqual(b.map(s => s.counts.join(",")));
  });
});
