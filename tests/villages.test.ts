import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { St, step, Place, type Person } from "../src/sim/people/person.ts";
import { campFood, homeOf, noFood, storeFood, type Band } from "../src/sim/people/band.ts";
import { eat, spoil } from "../src/sim/people/sharing.ts";
import { Idea, learn } from "../src/sim/people/ideas.ts";
import { Work, addWork, plotSite, resow, seedLine, sow, sowSite, worksDay, workById } from "../src/sim/people/works.ts";
import { digPit, storeInPit, pitOf, pitFood, pitSite, pitDay, raise, hutOf, hutStands, hutJob, hutHomes, leaveBehind, stakeDays, hutLookAt } from "../src/sim/people/homes.ts";
import { bandDetail, villageDetail } from "../src/sim/people/inspect.ts";
import { friendly, roomFor, villagesDay } from "../src/sim/people/villages.ts";
import { searchWorld } from "../src/sim/people/search.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  First villages. Most of these set a moment up by hand (a family that knows how to dig a
  storage pit and has food to put by, a household raising a hut, a band deciding whether
  to move with food in the ground and a roof over its head) and check that it goes the
  way it should. Nothing here is triggered by a date: everything follows from what people
  know, what they have and where they are.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(bands = 8) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 4, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands }, t0);
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
  return { s, run };
}
const grown = (s: Society, b: Band) => b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 55);
/** A grown-up who heads a household, and their band. */
function headOf(s: Society, b: Band): Person { return grown(s, b).find(q => homeOf(q, s.byId, s.time) === q.id && q.partner) ?? grown(s, b)[0]; }
/** Runs a step to its end, as the person would. */
function finish(s: Society, p: Person, k: St, x: number, y: number, id = 0, a = 0): void {
  const st = step(k, x, y, id, 1, { a });
  if (k === St.Pit) digPit(s, p, st); else if (k === St.Store) storeInPit(s, p, st); else raise(s, p, st);
}

describe("every kind of step is carried out", () => {
  it("the step switch handles every step a plan can hold", () => {
    const src = readFileSync("src/sim/people/doing.ts", "utf8"), person = readFileSync("src/sim/people/person.ts", "utf8");
    const names = [...person.match(/export const St = \{([^}]*)\}/)![1].matchAll(/(\w+):/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) expect(src.includes(`case St.${n}:`), `St.${n} has no case in doStep`).toBe(true);
  });
});

describe("storage pits", () => {
  const { s } = fresh();
  const b = s.bands[0], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
  learn(s, p, Idea.Pits, null, "seen");
  it("a family that knows how digs a pit by its shelter", () => {
    const at = pitSite(s, b, home)!;
    expect(at).not.toBeNull();
    finish(s, p, St.Pit, at[0], at[1]);
    const pit = pitOf(s, b, home)!;
    expect(pit).not.toBeNull();
    expect(pit.home).toBe(home);
    expect(s.events.some(e => e.kind === "pit")).toBe(true);
  });
  it("puts food by from the hearth, and the band counts it as food in camp", () => {
    const pit = pitOf(s, b, home)!, h = b.hearths.get(home) ?? (b.hearths.set(home, noFood()), b.hearths.get(home)!);
    h.plant = 40; h.dried = 6;
    const before = campFood(b);
    finish(s, p, St.Store, pit.x, pit.y, pit.id);
    expect(pitFood(pit)).toBeGreaterThan(5);
    expect(h.plant + h.dried).toBeLessThan(46);
    expect(campFood(b)).toBeCloseTo(before, 3);
  });
  it("keeps plant food far longer than a hearth does", () => {
    const pit = pitOf(s, b, home)!, inPit = pit.foods!.plant;
    const hearth = { ...noFood(), plant: inPit };
    for (let d = 0; d < 40; d++) { pitDay(s, pit, true); spoil(hearth, 0.2, 0.97, 0.996); }
    expect(pit.foods!.plant).toBeGreaterThan(inPit * 0.8);
    expect(hearth.plant).toBeLessThan(inPit * 0.35);
  });
  it("feeds the family when the hearth and the pot are bare", () => {
    const pit = pitOf(s, b, home)!, h = b.hearths.get(home)!;
    h.plant = 0; h.meat = 0; h.fish = 0; h.dried = 0;
    b.store.plant = 0; b.store.meat = 0; b.store.fish = 0; b.store.dried = 0;
    p.x = pit.x; p.y = pit.y; p.food = 0.1;
    const had = pitFood(pit), got = eat(s, p, b, 1);
    expect(got).toBeGreaterThan(0.9);
    expect(pitFood(pit)).toBeLessThan(had);
  });
});

describe("what a band can carry", () => {
  const { s } = fresh();
  it("a band setting off leaves what it cannot carry, in a pit if it has one", () => {
    const b = s.bands[1], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
    learn(s, p, Idea.Pits, null, "seen");
    const at = pitSite(s, b, home)!; finish(s, p, St.Pit, at[0], at[1]);
    const pit = pitOf(s, b, home)!;
    b.store.plant = 400; b.store.dried = 50;
    const h = b.hearths.get(home) ?? (b.hearths.set(home, noFood()), b.hearths.get(home)!);
    h.plant = 200;
    const lost = leaveBehind(s, b);
    let carried = storeFood(b.store); for (const x of b.hearths.values()) carried += storeFood(x);
    expect(carried).toBeLessThan(b.members.length * 7.6);
    expect(lost).toBeGreaterThan(100);
    expect(pitFood(pit)).toBeGreaterThan(10);
  });
});

describe("huts", () => {
  const { s } = fresh();
  const b = s.bands[2], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
  learn(s, p, Idea.Huts, null, "seen");
  it("go up a little at a time: a frame of poles, then the covering", () => {
    const job = hutJob(s, p, b)!;
    expect(job).not.toBeNull();
    let n = 0;
    while (n < 60 && !hutStands(hutOf(s, b, home))) {
      p.carryKind = 4; p.carryAmt = 3;
      const hut = hutOf(s, b, home);
      finish(s, p, St.Raise, hut ? hut.x : job.x, hut ? hut.y : job.y, hut?.id ?? 0);
      n++;
    }
    const hut = hutOf(s, b, home)!;
    expect(n).toBeGreaterThan(4);
    expect(hutStands(hut)).toBe(true);
    expect(hut.style).toBe(s.cultures[b.culture].hut);
    expect(hut.look).toBe(hutLookAt(s, hut.x, hut.y));
    expect(s.events.some(e => e.kind === "hut")).toBe(true);
    /* the family remembers it as home */
    expect(p.places.some(pl => pl.k === Place.Home && pl.ref === hut.id)).toBe(true);
  });
  it("stays where it was built when the camp is laid out again", () => {
    const hut = hutOf(s, b, home)!, at = b.homes.get(home)!;
    s.layoutHomes(b); s.layoutHomes(b);
    const again = b.homes.get(home)!;
    expect(again[2]).toBe(hut.id);
    expect(again[0]).toBeCloseTo(at[0], 5);
    expect(bandDetail(s, b.id)!.homes).toMatch(/1 hut/);
  });
  it("passes to the partner when the one who raised it dies", () => {
    const hut = hutOf(s, b, home)!, partner = s.byId.get(p.partner);
    if (!partner) return;
    s.die(p, "old age");
    s.layoutHomes(b);
    expect(hutHomes(workById(s, hut.id)!)).toContain(homeOf(partner, s.byId, s.time));
  });
  it("wears slowly while lived in, and falls in once left", () => {
    const hut = hutOf(s, b, s.heads(b).find(h => hutOf(s, b, h)) ?? 0)!;
    const kept = hut.state;
    for (let d = 0; d < 20; d++) worksDay(s);
    expect(hut.state).toBeGreaterThan(kept - 0.05);
    b.x += 60; b.y += 0;
    for (let d = 0; d < 160; d++) worksDay(s);
    expect(hut.state).toBeLessThan(0.2);
    b.x -= 60;
  });
});

describe("a stake in a place", () => {
  const { s } = fresh();
  it("a household with food in the ground and a hut has more to lose by leaving, with winter coming most of all", () => {
    const b = s.bands[3], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
    const none = stakeDays(s, b, home, 0);
    learn(s, p, Idea.Pits, null, "seen");
    const at = pitSite(s, b, home)!; finish(s, p, St.Pit, at[0], at[1]);
    pitOf(s, b, home)!.foods!.plant = 30;
    expect(stakeDays(s, b, home, 0)).toBeGreaterThan(none + 3);
  });
});

describe("fields", () => {
  const { s } = fresh();
  const b = s.bands[4], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
  learn(s, p, Idea.Digging, null, "seen"); learn(s, p, Idea.Planting, null, "seen");
  it("a plot whose household still lives by it rests after the harvest instead of going back to weeds", () => {
    const at = plotSite(s, b)!;
    sow(s, p, at);
    const w = s.works.find(k => k.kind === Work.Plot && k.home === home)!;
    for (let d = 0; d < 45 && w.state < 1; d++) { s.time += DAY_SECONDS; worksDay(s); }
    expect(w.state).toBe(1);
    for (let d = 0; d < 30; d++) { s.time += DAY_SECONDS; worksDay(s); }
    expect(s.works.includes(w)).toBe(true);
    expect(w.fallow).toBe(true);
    expect(sowSite(s, b, home)!.field).toBe(w);
  });
  it("is sown again from the band's own seed, which grows a little tamer with each harvest", () => {
    const w = s.works.find(k => k.kind === Work.Plot && k.home === home)!;
    b.seed[w.crop] = 0.3;
    resow(s, p, w);
    expect(w.fallow).toBe(false);
    expect(w.sown).toBe(2);
    expect(w.tame).toBeCloseTo(0.3, 5);
    expect(s.events.some(e => e.kind === "field")).toBe(true);
    seedLine(s, p, w);
    expect(b.seed[w.crop]).toBeGreaterThan(0.3);
  });
  it("goes back to weeds once nobody lives by it", () => {
    const w = s.works.find(k => k.kind === Work.Plot && k.home === home)!;
    w.fallow = true; w.kept = s.time;
    b.x += 80;
    for (let d = 0; d < 45; d++) { s.time += DAY_SECONDS; worksDay(s); }
    b.x -= 80;
    expect(s.works.includes(w)).toBe(false);
  });
});

describe("gatherings", () => {
  const { s } = fresh();
  it("bands of one people on good terms may camp side by side; strangers keep their distance", () => {
    const [a, c] = s.bands.filter(b => b.culture === s.bands[0].culture);
    const stranger = s.bands.find(b => b.culture !== a.culture)!;
    expect(friendly(s, a, c)).toBe(true);
    expect(friendly(s, a, stranger)).toBe(false);
    expect(roomFor(s, a, c.x + 15, c.y)).toBe(true);
    expect(roomFor(s, a, c.x + 2, c.y)).toBe(false);
    expect(roomFor(s, a, stranger.x + 15, stranger.y)).toBe(false);
  });
  it("two bands camped together are a gathering, told of once it lasts, and its breaking up is told too", () => {
    const [a, c] = s.bands.filter(b => b.culture === s.bands[0].culture);
    const ax = a.x, ay = a.y;
    a.x = c.x + 15; a.y = c.y;
    villagesDay(s);
    expect(s.gatherings.length).toBe(1);
    s.time += DAY_SECONDS * 3;
    villagesDay(s);
    expect(s.events.some(e => e.kind === "gather" && e.text.includes(a.name) && e.text.includes(c.name))).toBe(true);
    a.x = ax; a.y = ay;
    villagesDay(s);
    expect(s.gatherings.length).toBe(0);
    expect(s.events.some(e => e.kind === "disperse")).toBe(true);
  });
});

describe("villages", () => {
  const { s } = fresh();
  const b = s.bands[5];
  /** Raises a standing hut for each of a band's first households. */
  const huts = (n: number) => {
    const heads = s.heads(b).slice(0, n);
    heads.forEach((h, k) => {
      const a = k / n * Math.PI * 2, x = b.x + Math.cos(a) * 5, y = b.y + Math.sin(a) * 4;
      const w = addWork(s, { kind: Work.Hut, x, y, wx: x, wy: y, band: b.id, home: h, by: h, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, built: s.time + k, style: s.cultures[b.culture].hut, look: "plain", size: 1 });
      b.homes.set(h, [x, y, w.id]);
    });
  };
  it("a band that has lived a whole year in one place, in huts, is a village, with a name in its own tongue", () => {
    huts(4);
    b.movedAt = s.time - DAY_SECONDS * 41;
    villagesDay(s);
    const v = s.villages[0];
    expect(v).toBeDefined();
    expect(v.name).toMatch(/^[A-Z][a-z]+$/);
    expect(v.gloss.length).toBeGreaterThan(3);
    expect(b.siteName).toBe(v.name);
    const e = s.events.find(x => x.kind === "village")!;
    expect(e.text).toContain(v.name);
    expect(e.text).toContain(v.gloss);
    expect(e.sig).toBeGreaterThan(0.8);
    expect(villageDetail(s, v.id)!.huts).toBe(4);
    expect(searchWorld(s, v.name.slice(0, 4)).some(i => i.kind === "village" && i.id === v.id)).toBe(true);
    expect(bandDetail(s, b.id)!.village).toBe(v.name);
  });
  it("is given up after a year with nobody living there, and comes back to life when a band returns", () => {
    const v = s.villages[0], bx = b.x;
    b.x += 90;
    for (let d = 0; d < 42; d++) { s.time += DAY_SECONDS; villagesDay(s); }
    expect(v.abandoned).toBeGreaterThan(0);
    expect(s.events.some(e => e.kind === "abandon" && e.text.includes(v.name))).toBe(true);
    b.x = bx;
    villagesDay(s);
    expect(v.abandoned).toBe(0);
    expect(s.events.some(e => e.kind === "return" && e.text.includes(v.name))).toBe(true);
  });
  it("is named for the weightiest thing that happened there, when something did", () => {
    const { s: t } = fresh();
    const c = t.bands[1], hunter = headOf(t, c);
    t.event("kill", 0, `${hunter.name} brought down a mammoth.`, c.x + 2, c.y, [hunter.id], c.id, 2);
    const heads = t.heads(c).slice(0, 3);
    heads.forEach((h, k) => { const x = c.x + 4 * Math.cos(k * 2), y = c.y + 3 * Math.sin(k * 2); const w = addWork(t, { kind: Work.Hut, x, y, wx: x, wy: y, band: c.id, home: h, by: h, t: t.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, built: t.time, style: "round", look: "plain", size: 1 }); c.homes.set(h, [x, y, w.id]); });
    c.movedAt = t.time - DAY_SECONDS * 41;
    villagesDay(t);
    expect(t.villages[0].gloss).toBe("Mammoth Fell");
    expect(t.villages[0].why).toContain(hunter.name);
  });
});

describe("putting food by, of their own accord", () => {
  it("a family that knows how, with more food that keeps than it can eat, digs a pit and fills it", () => {
    const { s, run } = fresh();
    const b = s.bands[0];
    for (const id of b.members) { const q = s.byId.get(id)!; if (s.age(q) >= 14) learn(s, q, Idea.Pits, null, "seen"); }
    for (let d = 0; d < 20; d++) { for (const h of s.heads(b)) { const hh = b.hearths.get(h) ?? (b.hearths.set(h, noFood()), b.hearths.get(h)!); hh.plant = Math.max(hh.plant, 30); } run(1 / 40); }
    expect(s.stats.homes.pits).toBeGreaterThan(0);
    expect(s.stats.homes.stored).toBeGreaterThan(0);
  });
});

describe("a few years of staying put", () => {
  /* everyone already knows how to build huts and keep food in the ground, so the years show what that does */
  const live = () => {
    const { s, run } = fresh(12);
    for (const p of s.people) if (s.age(p) >= 14) { learn(s, p, Idea.Huts, null, "seen"); learn(s, p, Idea.Pits, null, "seen"); }
    run(3);
    return s;
  };
  const s = live();
  it("huts go up where bands stay long", () => {
    expect(s.stats.homes.huts).toBeGreaterThan(0);
    expect(s.works.some(w => w.kind === Work.Hut)).toBe(true);
  });
  it("lives the same life from the same seed", () => {
    const again = live();
    expect(again.stats.homes).toEqual(s.stats.homes);
    expect(again.villages.map(v => v.name)).toEqual(s.villages.map(v => v.name));
    expect(again.people.length).toBe(s.people.length);
  });
});
