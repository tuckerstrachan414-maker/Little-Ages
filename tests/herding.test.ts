import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife, EATS, GRASS, FECUND, MORTAL } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society, MEAT, type Carcass } from "../src/sim/people/society.ts";
import { St, Mem, Goal, step, type Person } from "../src/sim/people/person.ts";
import { homeOf, noFood, type Band } from "../src/sim/people/band.ts";
import { Idea, learn, knows } from "../src/sim/people/ideas.ts";
import { techIx, techByKey, DURING } from "../src/sim/tech/tree.ts";
import { Problem, problemsDay } from "../src/sim/tech/problems.ts";
import { HUNT_P, DANGER, SPECIES_SHORT } from "../src/sim/people/mind.ts";
import { doStep } from "../src/sim/people/doing.ts";
import { addWork } from "../src/sim/people/works.ts";
import { Line } from "../src/sim/buildings/defs.ts";
import { wants } from "../src/sim/buildings/wants.ts";
import { personDetail, bandDetail } from "../src/sim/people/inspect.ts";
import { flocksDay, keepYoung, youngOf, herdSpell, wolfRisk, hasDogs, capacityOf, flockSpot, flockWords, keepsWords, herdsLine, flockQuads, flocksOf, type Flock } from "../src/sim/people/herding.ts";
import { Species, SPECIES_NAMES, DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";
import { Mat } from "../src/sim/economy/goods.ts";
import { Bubble } from "../src/shared/people.ts";
import { noteSite, eventName } from "../src/sim/people/villages.ts";

/*
  Herding: the wild goats, sheep and boar of the land; the young of a kill carried home;
  flocks that graze, breed, slip away by night or are taken by wolves; folds and dogs that
  keep them; milk; and how keeping animals comes to the family that has fed them longest.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(bands = 8) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 2, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands }, t0);
  return { s, wild };
}
const grown = (s: Society, b: Band) => b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 55);
const bigBand = (s: Society) => s.bands.slice().sort((a, c) => c.members.length - a.members.length)[0];
/** A flock kept by someone's household, placed as the day's pass would place it. */
function flockFor(s: Society, b: Band, p: Person, sp: number, n: number, young: number, tame: number, keptDaysAgo = 0): Flock {
  const f: Flock = { id: s.nextId++, band: b.id, home: homeOf(p, s.byId, s.time), sp, n, young, tame, cond: 0.8, x: b.x, y: b.y, pen: 0, kept: s.time - keptDaysAgo * DAY_SECONDS, herder: 0, fleece: 0, lostAt: 0, unfed: 0, slaughteredAt: 0, mindedAt: 0, born: 0 };
  [f.x, f.y] = flockSpot(s, b, f);
  s.flocks.push(f);
  return f;
}
/** Days pass: the land grows, and the flocks are kept. The seasons turn with the days unless one is held. */
const days = (s: Society, n: number, season = -1) => { for (let k = 0; k < n; k++) { s.time += DAY_SECONDS; s.day++; s.season = season >= 0 ? season : Math.floor(s.time / DAY_SECONDS / DAYS_PER_SEASON) % 4; s.eco.daily(s.season); flocksDay(s); } };
const know = (s: Society, p: Person, key: string) => { if (!knows(p, techIx(key))) learn(s, p, techIx(key), null, "seen"); };
/** A household's hearth, made if it has none yet. */
const hearthFor = (b: Band, head: number) => { let h = b.hearths.get(head); if (!h) { h = noFood(); b.hearths.set(head, h); } return h; };

describe("the wild beasts people come to keep", () => {
  it("goats, sheep and boar roam the land, and every table knows the ten kinds", () => {
    const { wild } = fresh();
    expect(SPECIES_NAMES.length).toBe(10);
    for (const t of [HUNT_P, DANGER, SPECIES_SHORT, MEAT, EATS, GRASS, FECUND, MORTAL]) expect(t.length).toBe(10);
    const by = new Array(10).fill(0); for (const h of wild.herds) by[h.sp] += h.n;
    expect(by[Species.Goat]).toBeGreaterThan(0);
    expect(by[Species.Sheep]).toBeGreaterThan(0);
    expect(by[Species.Boar]).toBeGreaterThan(0);
    expect(by[Species.Dog]).toBe(0);
  });
  it("animals let go join the nearest herd of their kind, or make a new one", () => {
    const { wild } = fresh();
    const goats = wild.herds.find(h => h.sp === Species.Goat)!;
    const n0 = goats.n;
    wild.release(Species.Goat, goats.x + 2, goats.y, 3);
    expect(goats.n).toBe(n0 + 3);
    const far = wild.herds.find(h => h.sp === Species.Deer && !wild.herds.some(o => o.sp === Species.Boar && Math.hypot(o.x - h.x, o.y - h.y) < 30))!;
    const count = wild.herds.length;
    wild.release(Species.Boar, far.x, far.y, 2);
    expect(wild.herds.length).toBe(count + 1);
    expect(wild.herds[count].sp).toBe(Species.Boar);
    wild.release(Species.Dog, far.x, far.y, 2);
    expect(wild.herds.length).toBe(count + 1);
  });
});

describe("keeping young", () => {
  it("a spring or summer kill may leave young standing by it; a well-fed, kind family carries them home", () => {
    const { s } = fresh();
    s.season = 1;
    let any = 0; for (let k = 0; k < 200; k++) any += youngOf(s, Species.Goat);
    expect(any).toBeGreaterThan(20);
    s.season = 2;
    let autumn = 0; for (let k = 0; k < 200; k++) autumn += youngOf(s, Species.Goat);
    expect(autumn).toBe(0);
    expect(youngOf(s, Species.Deer)).toBe(0);
    s.season = 1;
    const b = bigBand(s), p = grown(s, b)[0];
    const c: Carcass = { id: s.nextId++, x: p.x, y: p.y, sp: Species.Goat, meat: MEAT[Species.Goat], hides: 1, t: s.time, by: p.id, young: 2 };
    s.carcasses.push(c);
    const before = s.events.length;
    expect(keepYoung(s, p, c)).toBe(true);
    expect(c.young).toBe(0);
    const f = flocksOf(s, b, homeOf(p, s.byId, s.time))[0];
    expect(f).toBeTruthy(); expect(f.sp).toBe(Species.Goat); expect(f.n).toBe(0); expect(f.young).toBe(2); expect(f.tame).toBe(0);
    expect(p.mem.some(m => m.k === Mem.Kept)).toBe(true);
    expect(s.stats.herds.kept).toBe(2);
    const e = s.events.slice(before).find(e => e.kind === "kept")!;
    expect(e).toBeTruthy(); expect(e.text).toContain(p.name); expect(e.text).toContain("kids");
    expect(personDetail(s, p.id)!.keeps).toBe("keeps 2 kids");
    expect(bandDetail(s, b.id)!.herds).toContain("2 kids");
    expect(flockWords(f)).toBe("2 kids");
    /* a second carcass's young join the same flock */
    const c2: Carcass = { ...c, id: s.nextId++, young: 1 };
    keepYoung(s, p, c2);
    expect(flocksOf(s, b).length).toBe(1); expect(f.young).toBe(3);
    /* nobody keeps a wolf cub or a fawn */
    expect(keepYoung(s, p, { ...c, id: s.nextId++, sp: Species.Deer, young: 1 })).toBe(false);
  });
  it("happens at the butchering: a soft-hearted butcher with a stocked hearth keeps the kids", () => {
    const { s } = fresh();
    s.season = 0;
    const b = bigBand(s), p = grown(s, b)[0], home = homeOf(p, s.byId, s.time);
    p.traits[1] = 1;
    const h = hearthFor(b, home); h.plant = 40; h.dried = 20;
    const c: Carcass = { id: s.nextId++, x: p.x, y: p.y, sp: Species.Sheep, meat: MEAT[Species.Sheep], hides: 1, t: s.time, by: p.id, young: 1 };
    s.carcasses.push(c);
    let kept = false;
    for (let k = 0; k < 40 && !kept; k++) {
      c.young = 1; c.meat = 16; p.carryAmt = 0; p.carryKind = 0;
      p.plan = [step(St.Butcher, c.x, c.y, c.id, 1)]; p.si = 0; p.goal = Goal.Haul;
      doStep(s, p, 2);
      kept = flocksOf(s, b, home).some(f => f.sp === Species.Sheep && f.young > 0);
    }
    expect(kept).toBe(true);
    expect(c.young).toBe(0);
  });
});

describe("the flock", () => {
  it("grazes, breeds in spring and grows tamer in a fold; wild-hearted and unfolded, it slips away by night", () => {
    const { s } = fresh();
    const b = bigBand(s), [pa, pb] = grown(s, b).filter((q, i, a) => a.findIndex(o => homeOf(o, s.byId, s.time) === homeOf(q, s.byId, s.time)) === i);
    expect(pb).toBeTruthy();
    const homeA = homeOf(pa, s.byId, s.time);
    const pen = addWork(s, { kind: Line.Pen, x: b.x + 4, y: b.y + 3, wx: 0, wy: 0, band: b.id, home: homeA, by: pa.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, tier: 0, def: "pen0", owner: 0 });
    const A = flockFor(s, b, pa, Species.Goat, 6, 0, 0.5), B = flockFor(s, b, pb, Species.Goat, 6, 0, 0);
    days(s, 1);
    expect(A.pen).toBe(pen.id); expect(capacityOf(s, A)).toBe(12); expect(A.x).toBe(pen.x);
    expect(B.pen).toBe(0); expect(capacityOf(s, B)).toBe(8);
    days(s, 200);
    expect(s.stats.herds.born).toBeGreaterThan(0);
    expect(A.n + A.young + s.stats.herds.slaughtered).toBeGreaterThanOrEqual(8);
    expect(A.cond).toBeGreaterThan(0.3);
    expect(A.tame).toBeGreaterThan(0.5);
    /* more than the fold holds is eaten: a carcass at the fold the family knows of */
    expect(A.n + A.young).toBeLessThanOrEqual(18);
    expect(s.stats.herds.slaughtered).toBeGreaterThan(0);
    expect(pa.places.some(pl => pl.k === 6 && pl.sp === Species.Goat)).toBe(true);
    /* the unfolded, untamed flock is gone, and its keeper remembers the losses */
    expect(B.n + B.young).toBeLessThanOrEqual(1);
    expect(s.stats.herds.escaped).toBeGreaterThan(0);
    expect(s.byId.get(B.home)!.mem.some(m => m.k === Mem.HerdLoss)).toBe(true);
    /* a night's wandering off never weighs like a wolf raid, however many slipped away */
    expect(s.byId.get(B.home)!.mem.some(m => m.k === Mem.HerdLoss && m.v >= -0.29)).toBe(true);
    expect(s.events.some(e => e.kind === "herd" && e.text.includes("wandered off"))).toBe(true);
  });
  it("a fold keeps even wild-hearted animals in", () => {
    const { s } = fresh();
    const b = bigBand(s), p = grown(s, b)[0], home = homeOf(p, s.byId, s.time);
    addWork(s, { kind: Line.Pen, x: b.x + 4, y: b.y + 3, wx: 0, wy: 0, band: b.id, home, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, tier: 0, def: "pen0", owner: 0 });
    const f = flockFor(s, b, p, Species.Sheep, 6, 0, 0);
    /* a family with food enough that it does not eat its animals */
    const h = hearthFor(b, home); h.plant = 200; h.dried = 100;
    days(s, 100, 1);
    /* none slipped away, none were eaten or taken: whatever is missing died of age or accident */
    expect(s.stats.herds.escaped).toBe(0);
    expect(s.stats.herds.slaughtered).toBe(0);
    expect(s.stats.herds.lost).toBe(0);
    expect(f.n + s.stats.herds.died).toBe(6);
    expect(f.n).toBeGreaterThanOrEqual(1);
  });
  it("wolves in the night take animals, fewer from a fold and fewer with dogs about", () => {
    const { s } = fresh();
    const b = bigBand(s), p = grown(s, b)[0];
    const f = flockFor(s, b, p, Species.Goat, 6, 2, 0.5);
    expect(wolfRisk(s, b, f, 6)).toBeCloseTo(0.24, 5);
    f.pen = addWork(s, { kind: Line.Pen, x: b.x + 4, y: b.y + 3, wx: 0, wy: 0, band: b.id, home: f.home, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, tier: 0, def: "pen0", owner: 0 }).id;
    expect(wolfRisk(s, b, f, 6)).toBeCloseTo(0.08, 5);
    const dogs = flockFor(s, b, p, Species.Dog, 2, 0, 1);
    expect(hasDogs(s, b)).toBe(true);
    expect(wolfRisk(s, b, f, 6)).toBeCloseTo(0.02, 5);
    dogs.n = 0; f.pen = 0;
    /* a pack beside the fold */
    s.wild.herds.push({ id: 99999, sp: Species.Wolf, x: f.x + 3, y: f.y, n: 8, tx: f.x + 3, ty: f.y, state: 0, timer: 1e9, heading: 0, hunger: 1, prey: -1, cond: 0.8 });
    const before = f.n + f.young;
    for (let k = 0; k < 30 && f.n + f.young === before; k++) days(s, 1, 2);
    expect(f.n + f.young).toBeLessThan(before);
    expect(s.stats.herds.lost).toBeGreaterThan(0);
    expect(p.mem.some(m => m.k === Mem.HerdLoss)).toBe(true);
    expect(s.events.some(e => e.kind === "herd" && e.text.includes("wolves"))).toBe(true);
    problemsDay(s, b);
    expect(b.problems[Problem.HerdLoss]).toBeGreaterThan(0);
  });
});

describe("how keeping animals comes to a people", () => {
  it("keeping goats comes to the one who has fed the kids a year, pressed by a want of meat; pigs only to someone with piglets; then milk, then the fold", () => {
    const { s } = fresh();
    const b = bigBand(s), p = grown(s, b)[0];
    p.traits[4] = 0.9; p.skills[0] = 0.8; p.skills[1] = 0.8;
    expect(knows(p, Idea.Snares)).toBe(true);
    const f = flockFor(s, b, p, Species.Goat, 2, 2, 0.1, 50);
    for (const o of s.bands) { o.problems[Problem.Meat] = 1; o.problems[Problem.Hunger] = 1; o.problems[Problem.HerdLoss] = 0; }
    const st = step(St.Herd, f.x, f.y, f.id, 6);
    const goats = techIx("herding-goats-and-sheep"), pigs = techIx("herding-pigs"), cattle = techIx("herding-cattle"), milking = techIx("milking"), penning = techIx("penning");
    for (let k = 0; k < 4000 && !knows(p, goats); k++) herdSpell(s, p, st);
    expect(knows(p, goats)).toBe(true);
    expect(knows(p, pigs)).toBe(false); expect(knows(p, cattle)).toBe(false);
    const found = s.events.find(e => e.kind === "discover" && e.text.includes("goats"))!;
    expect(found).toBeTruthy(); expect(found.text).toContain(p.name); expect(found.text).toContain("Nobody anywhere has done it before.");
    expect(f.tame).toBeGreaterThan(0.1);
    /* known, the animals settle; the first tame flock anywhere is told of */
    const before = s.events.length;
    days(s, 1, 1);
    expect(f.tame).toBeGreaterThanOrEqual(0.3);
    const tamed = s.events.slice(before).find(e => e.kind === "tamed")!;
    expect(tamed).toBeTruthy(); expect(tamed.text).toContain("goats"); expect(tamed.text).toContain("Nobody anywhere has kept them before."); expect(tamed.title).toBe("The first tame animals anywhere");
    expect(s.tamed.size).toBe(1);
    /* milk comes to a herder whose animals have young and whose children go hungry */
    f.young = 2; f.n = 3;
    for (let k = 0; k < 4000 && !knows(p, milking); k++) herdSpell(s, p, st);
    expect(knows(p, milking)).toBe(true);
    const home = homeOf(p, s.byId, s.time), folk = b.members.map(id => s.byId.get(id)!).filter(q => homeOf(q, s.byId, s.time) === home);
    for (const q of folk) q.food = 0.5;
    const milk0 = s.stats.herds.milk;
    days(s, 1, 1);
    expect(s.stats.herds.milk).toBeGreaterThan(milk0);
    expect(folk.some(q => q.dayDiet[2] > 0)).toBe(true);
    expect(folk.some(q => q.food > 0.5)).toBe(true);
    /* the fold comes after animals have been lost in the night */
    know(s, p, "huts");
    f.lostAt = s.time; for (const o of s.bands) o.problems[Problem.HerdLoss] = 1;
    for (let k = 0; k < 4000 && !knows(p, penning); k++) herdSpell(s, p, st);
    expect(knows(p, penning)).toBe(true);
    f.n = 4; f.young = 2;
    const wt = wants(s, p, b).find(w => w.def.id === "pen0")!;
    expect(wt).toBeTruthy(); expect(wt.owner).toBe("household"); expect(wt.why).toContain("fold");
    /* a flock of pigs brings keeping pigs, not goats, to its keeper */
    const q = grown(s, b).find(o => homeOf(o, s.byId, s.time) !== home)!;
    q.traits[4] = 0.9; q.skills[0] = 0.8;
    const g = flockFor(s, b, q, Species.Boar, 1, 2, 0.1, 50);
    const st2 = step(St.Herd, g.x, g.y, g.id, 6);
    for (let k = 0; k < 4000 && !knows(q, pigs); k++) herdSpell(s, q, st2);
    expect(knows(q, pigs)).toBe(true);
    expect(knows(q, goats)).toBe(false);
  });
  it("dogs: wolf pups drawn in by scraps are taken in, and the family that raised them works out what they are", () => {
    const { s } = fresh();
    const b = bigBand(s);
    s.wild.herds.push({ id: 99998, sp: Species.Wolf, x: b.x + 6, y: b.y, n: 5, tx: b.x + 6, ty: b.y, state: 0, timer: 1e9, heading: 0, hunger: 0.5, prey: -1, cond: 0.8 });
    b.movedAt = s.time - DAY_SECONDS * 30; b.pupsAt = 0;
    let dogs: Flock | undefined;
    for (let k = 0; k < 600 && !dogs; k++) { b.yesterday.spoiled = 5; days(s, 1, 2); dogs = flocksOf(s, b).find(f => f.sp === Species.Dog); }
    expect(dogs).toBeTruthy();
    expect(dogs!.n + dogs!.young).toBeGreaterThanOrEqual(1); expect(dogs!.tame).toBeGreaterThanOrEqual(0.5);
    /* pups with no grown dog among them are fed like any flock: their condition is a number, not nothing divided by nothing */
    days(s, 1, 2);
    expect(Number.isFinite(dogs!.cond)).toBe(true); expect(dogs!.cond).toBeGreaterThan(0);
    expect(s.eco.hunt(b.x, b.y, 0)).toBe(0);
    expect(s.stats.herds.pups).toBe(2);
    const e = s.events.find(e => e.kind === "kept" && e.title === "Wolf pups taken in")!;
    expect(e).toBeTruthy(); expect(e.text).toContain("wolf pups"); expect(e.title).toBe("Wolf pups taken in");
    const keeper = s.byId.get(e.who[0])!;
    expect(keeper.mem.some(m => m.k === Mem.Kept)).toBe(true);
    /* fed meat, they stay; the keeper sees what they are without any other want */
    keeper.traits[4] = 0.9;
    const h = hearthFor(b, homeOf(keeper, s.byId, s.time)); h.meat = 50;
    for (const o of s.bands) for (let k = 0; k < o.problems.length; k++) o.problems[k] = 0;
    const st = step(St.Herd, dogs!.x, dogs!.y, dogs!.id, 6);
    const tech = techIx("taming-dogs");
    for (let k = 0; k < 4000 && !knows(keeper, tech); k++) herdSpell(s, keeper, st);
    expect(knows(keeper, tech)).toBe(true);
    days(s, 1, 2);
    expect(dogs!.tame).toBe(1);
    dogs!.n = 2; dogs!.young = 0;
    expect(hasDogs(s, b)).toBe(true);
    /* with no flesh to spare, the dogs live on scraps of the family's plant food; unfed for days, they go their own way */
    h.meat = 0; h.fish = 0; h.dried = 0; b.store.meat = 0; b.store.fish = 0; b.store.dried = 0; h.plant = 40;
    days(s, 12, 3);
    expect(dogs!.n).toBe(2);
    expect(h.plant).toBeLessThan(40);
    h.plant = 0;
    days(s, 12, 3);
    expect(dogs!.n).toBeLessThan(2);
    expect(s.stats.herds.strayed).toBeGreaterThan(0);
  });
  it("the ways of keeping animals are alive in the tree, and come to mind while minding the flock", () => {
    for (const k of ["taming-dogs", "herding-goats-and-sheep", "herding-cattle", "herding-pigs", "milking", "penning"]) {
      const d = techByKey(k)!; expect(d.active, k).toBe(true); expect(d.story, k).toBeTruthy(); expect(d.spark, k).toBeGreaterThan(0);
      expect(DURING[St.Herd], k).toContain(d.id);
    }
    expect(techByKey("herding-goats-and-sheep")!.ctx).toEqual(["goats"]);
  });
});

describe("whose animals they are", () => {
  it("pass to the partner when the keeper dies, go along to another band, and go wild when the band ends", () => {
    const { s } = fresh();
    const b = bigBand(s);
    const head = grown(s, b).find(q => q.partner && s.byId.get(q.partner)?.band === b.id && homeOf(q, s.byId, s.time) === q.id)!;
    expect(head).toBeTruthy();
    const partner = s.byId.get(head.partner)!;
    const f = flockFor(s, b, head, Species.Goat, 5, 1, 0.5);
    s.die(head, "illness");
    days(s, 1, 2);
    expect(s.flocks).toContain(f);
    expect(f.home).toBe(homeOf(partner, s.byId, s.time));
    const other = s.bands.find(o => o !== b && o.members.length >= 3)!;
    s.moveTo(partner, other);
    expect(f.band).toBe(other.id);
    expect(flocksOf(s, other).length).toBe(1);
    const goats0 = s.wild.herds.filter(h => h.sp === Species.Goat).reduce((n, h) => n + h.n, 0);
    s.endBand(other, "is no more", false);
    expect(s.flocks.some(o => o.band === other.id)).toBe(false);
    expect(s.wild.herds.filter(h => h.sp === Species.Goat).reduce((n, h) => n + h.n, 0)).toBe(goats0 + 6);
  });
  it("the renderer and the cards hear of them", () => {
    const { s } = fresh();
    const b = bigBand(s), p = grown(s, b)[0];
    flockFor(s, b, p, Species.Goat, 5, 1, 0.5);
    flockFor(s, b, p, Species.Dog, 1, 0, 1);
    const q = flockQuads(s, b);
    expect(q.length).toBe(8); expect(q[2]).toBe(Species.Goat); expect(q[3]).toBe(6); expect(q[6]).toBe(Species.Dog);
    expect(s.campSnaps().find(c => c.id === b.id)!.flocks).toEqual(q);
    expect(keepsWords(s, p)).toBe("keeps 5 goats and a kid, and a dog");
    expect(herdsLine(s, b)).toBe("one family keeps 5 goats and a kid and a dog; the goats and dogs come when called");
    expect(bandDetail(s, b.id)!.herds).toContain("goats");
  });
});

describe("what the cards and the chronicle say of the animals", () => {
  it("tells a night's wandering off from a wolf raid, pups taken in from young carried home, and names what is carried", () => {
    const { s } = fresh();
    const b = bigBand(s), p = grown(s, b)[0];
    const texts = () => personDetail(s, p.id)!.memories.map(m => m.text);
    s.remember(p, Mem.HerdLoss, 0, Math.max(-0.29, -0.2 * 3), Species.Goat);
    expect(texts()).toContain("An animal the family kept wandered off in the night");
    s.remember(p, Mem.HerdLoss, 0, -0.4, Species.Sheep);
    expect(texts()).toContain("Wolves got in among the animals the family keeps");
    s.remember(p, Mem.Kept, 0, 0.4, Species.Dog);
    expect(texts()).toContain("Took in wolf pups that came for the camp's scraps and fed them at the hearth");
    s.remember(p, Mem.Kept, 0, 0.5, Species.Goat);
    expect(texts()).toContain("Carried young animals home from a kill and fed them at the hearth");
    p.carryKind = Mat.Clay; p.carryAmt = 6;
    expect(personDetail(s, p.id)!.carrying).toBe("6 clay");
    p.carryKind = Mat.Hides; p.carryAmt = 2;
    expect(personDetail(s, p.id)!.carrying).toBe("2 hides");
    p.carryKind = Mat.Wood; p.carryAmt = 1;
    expect(personDetail(s, p.id)!.carrying).toBe("1 firewood");
    p.carryKind = Mat.None; p.carryAmt = 0;
    expect(personDetail(s, p.id)!.carrying).toBe("");
  });
  it("headlines dogs as dogs, and a taming can name the place it happened", () => {
    const { s } = fresh();
    const b = bigBand(s);
    s.event("tamed", Bubble.Wolf, "The test keep dogs now.", b.x, b.y, [], b.id, 16 + Species.Dog);
    expect(s.events.at(-1)!.title).toBe("A people keeps dogs");
    s.event("tamed", Bubble.Wolf, "The test keep dogs now.", b.x, b.y, [], b.id, 32 + Species.Dog);
    expect(s.events.at(-1)!.title).toBe("The first dogs anywhere");
    s.event("tamed", Bubble.Goat, "The test keep goats now.", b.x, b.y, [], b.id, 16 + Species.Goat);
    expect(s.events.at(-1)!.title).toBe("A people takes to herding");
    s.event("tamed", Bubble.Goat, "The test keep goats now.", b.x, b.y, [], b.id, 32 + Species.Sheep);
    expect(s.events.at(-1)!.title).toBe("The first tame animals anywhere");
    /* the place keeps the name */
    const x = b.x + 300, y = b.y + 300;
    noteSite(s, "tamed", 0.95, 32 + Species.Goat, [], x, y);
    const fold = eventName(s, x, y);
    expect(fold?.gloss).toBe("Goat Fold"); expect(fold?.words).toEqual(["goat", "fold"]); expect(fold?.why).toContain("the first goats anyone tamed");
    noteSite(s, "tamed", 0.97, 16 + Species.Dog, [], x + 60, y);
    const hearth = eventName(s, x + 60, y);
    expect(hearth?.gloss).toBe("Dog Hearth"); expect(hearth?.why).toContain("the dogs a family were the first of their people to keep there"); expect(hearth?.why).not.toContain("anyone");
    /* sheep are sheep, not "sheeps" */
    noteSite(s, "tamed", 0.96, 32 + Species.Sheep, [], x, y + 60);
    const sheep = eventName(s, x, y + 60);
    expect(sheep?.gloss).toBe("Sheep Fold"); expect(sheep?.why).toContain("the first sheep anyone tamed"); expect(sheep?.why).not.toContain("sheeps");
  });
});
