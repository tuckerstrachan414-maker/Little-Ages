import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { Goal, St, step, type Person } from "../src/sim/people/person.ts";
import { homeOf, noFood, type Band } from "../src/sim/people/band.ts";
import { eat, hearthOf, hgoodsOf, take } from "../src/sim/people/sharing.ts";
import { inspire, learn, discover } from "../src/sim/people/ideas.ts";
import { techIx, techByKey } from "../src/sim/tech/tree.ts";
import { Problem } from "../src/sim/tech/problems.ts";
import { Diet, dietDay, dietScore, recoveryFactor, dietWords, noteMeal } from "../src/sim/economy/diet.ts";
import { illness } from "../src/sim/people/health.ts";
import { Mat } from "../src/sim/economy/goods.ts";
import { doStep } from "../src/sim/people/doing.ts";
import { startBuilding } from "../src/sim/buildings/build.ts";
import { defById } from "../src/sim/buildings/defs.ts";
import { personDetail } from "../src/sim/people/inspect.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  What people eat and how they fare: a mixed diet against one thing alone, pots that make
  plant food go further, herbs that help a fever break, and pottery coming to someone with
  clay at hand and food going bad.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(bands = 8) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 4, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands }, t0);
  return { s };
}
const adults = (s: Society, b: Band) => b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 50);
const know = (s: Society, p: Person, key: string) => learn(s, p, techIx(key), null, "seen");

describe("diet", () => {
  const { s } = fresh();
  const b = s.bands[0], p = adults(s, b)[0];
  it("tracks what is eaten, as running shares; one thing alone scores low, a mix scores full", () => {
    expect(dietScore(p)).toBeCloseTo(1, 5);
    for (let d = 0; d < 40; d++) { noteMeal(p, { plant: 0, meat: 1, fish: 0, dried: 0 }); dietDay(p); }
    expect(p.diet[Diet.Meat]).toBeGreaterThan(0.95); expect(p.diet[Diet.Plant]).toBeLessThan(0.05);
    expect(dietScore(p)).toBeLessThan(0.15);
    expect(dietWords(p)).toContain("mostly meat"); expect(dietWords(p)).toContain("little plant food");
    const meatOnly = recoveryFactor(p);
    for (let d = 0; d < 40; d++) { noteMeal(p, { plant: 0.6, meat: 0.3, fish: 0.1, dried: 0 }); dietDay(p); }
    expect(dietScore(p)).toBeCloseTo(1, 1);
    expect(recoveryFactor(p)).toBeGreaterThan(meatOnly * 1.25);
    /* a day with nothing eaten changes nothing */
    const before = p.diet.slice(); dietDay(p); expect([...p.diet]).toEqual([...before]);
    expect(personDetail(s, p.id)!.diet).toContain("eats");
  });
  it("eating from the hearth and the pot is what the diet is made of", () => {
    const h = hearthOf(s, p); h.plant = 2; h.meat = 0; h.fish = 0; h.dried = 0; b.store.meat = 2;
    p.dayDiet.fill(0); p.food = 0.5;
    const got = eat(s, p, b, 1);
    expect(got).toBeGreaterThan(0.99);
    expect(p.dayDiet[Diet.Plant]).toBeCloseTo(1, 5);
    const took = noFood(); take(b.store, 1, took); expect(took.meat).toBeCloseTo(1, 5);
  });
});

describe("pots", () => {
  const { s } = fresh();
  const b = s.bands[1], p = adults(s, b)[0], home = homeOf(p, s.byId, s.time);
  it("boiled in a pot over a lit fire, plant food goes further; as porridge the old eat their fill", () => {
    const h = hearthOf(s, p); h.plant = 10; h.meat = 0; h.fish = 0; h.dried = 0;
    b.fire = 0.8; p.x = b.x; p.y = b.y; p.food = 0.5;
    eat(s, p, b, 1); const plain = p.food - 0.5; expect(plain).toBeCloseTo(1, 5);
    hgoodsOf(s, p)[Mat.Pots] = 2; p.food = 0.5;
    eat(s, p, b, 1); expect(p.food - 0.5).toBeCloseTo(1.25, 5);
    /* an elder, with porridge known in the band */
    const old = b.members.map(id => s.byId.get(id)!).find(q => s.stage(q) === "elder") ?? p;
    const was = old.food; old.x = b.x; old.y = b.y;
    const hh = hearthOf(s, old); hh.plant = 10;
    hgoodsOf(s, old)[Mat.Pots] = 2; know(s, p, "pottery"); know(s, p, "grinding-grain"); know(s, p, "porridge"); b.can[techIx("porridge")] = 1;
    old.food = 0.5; eat(s, old, b, 1);
    expect(old.food - 0.5).toBeCloseTo(s.stage(old) === "elder" ? 1.5 : 1.25, 5);
    old.food = was;
  });
  it("are shaped from clay at the hearth and baked in the fire, where some crack; a kiln spares most of them", () => {
    know(s, p, "pottery");
    b.hgoods.clear(); hgoodsOf(s, p)[Mat.Pots] = 0; b.goods[Mat.Clay] = 30;
    const [hx, hy] = s.homeSpot(p);
    p.plan = [step(St.Shape, hx, hy, 0, 0.1, { a: 10 }), step(St.Bake, b.x, b.y, 0, 0.1)]; p.si = 0; p.goal = Goal.Pot; p.x = hx; p.y = hy;
    doStep(s, p, 0.2); expect(p.raw).toBe(10); expect(b.goods[Mat.Clay]).toBe(0);
    const before = s.events.filter(e => e.kind === "pots").length;
    doStep(s, p, 0.2);
    expect(p.raw).toBe(0);
    const made = hgoodsOf(s, p)[Mat.Pots]; expect(made + s.stats.pots.broke).toBe(10); expect(made).toBeGreaterThan(0);
    expect(s.events.filter(e => e.kind === "pots").length).toBe(before + 1);
    /* many batches: the open fire cracks about four in ten, the kiln about one in seven */
    let fire = 0, kiln = 0;
    for (let k = 0; k < 100; k++) { p.raw = 10; p.plan = [step(St.Bake, b.x, b.y, 0, 0.1)]; p.si = 0; doStep(s, p, 0.2); }
    fire = s.stats.pots.made;
    know(s, p, "kiln-firing");
    const k0 = startBuilding(s, p, defById("kiln0"), b.x + 3, b.y, "household", home); k0.prog = 1; k0.state = 1; k0.needs = undefined;
    const madeBefore = s.stats.pots.made, brokeBefore = s.stats.pots.broke;
    for (let k = 0; k < 100; k++) { p.raw = 10; p.plan = [step(St.Bake, k0.x, k0.y, k0.id, 0.1)]; p.si = 0; doStep(s, p, 0.2); }
    kiln = s.stats.pots.made - madeBefore;
    expect(kiln).toBeGreaterThan(fire * 0.6 / 1.0 * 1.2);
    expect((s.stats.pots.broke - brokeBefore) / 1000).toBeLessThan(0.25);
    expect(s.stats.pots.kiln).toBe(kiln);
    expect(b.broke).toBeGreaterThan(0);
  });
});

describe("herbs", () => {
  const { s } = fresh();
  const b = s.bands[2], [p, q] = adults(s, b);
  it("a fever tended by someone who knows which herbs help breaks sooner", () => {
    /* the tender at the sick one's side, and the camp's grid of who is where brought up to date */
    q.x = p.x + 1; q.y = p.y; s.update(0, s.time, s.season);
    const sickDrop = (herbs: boolean) => {
      if (herbs) know(s, q, "herb-lore"); else q.know[techIx("herb-lore")] = 0;
      let total = 0;
      for (let k = 0; k < 200; k++) { p.sick = 0.8; p.food = 1; q.x = p.x + 1; q.y = p.y; q.goal = Goal.Tend; illness(s, p, 30, "adult"); total += 0.8 - p.sick; }
      return total / 200;
    };
    const plain = sickDrop(false), withHerbs = sickDrop(true);
    expect(withHerbs).toBeGreaterThan(plain + 0.1);
    /* a deadly fever turns mild more often under herbs */
    const turns = (herbs: boolean) => {
      if (herbs) know(s, q, "herb-lore"); else q.know[techIx("herb-lore")] = 0;
      let n = 0; for (let k = 0; k < 600; k++) { p.sick = 1.5; q.goal = Goal.Tend; illness(s, p, 30, "adult"); if (p.sick < 1) n++; }
      return n;
    };
    expect(turns(true)).toBeGreaterThan(turns(false) * 1.25);
    p.sick = 0; q.goal = Goal.None;
  });
  it("one kind of food alone makes illness likelier", () => {
    for (let d = 0; d < 40; d++) { noteMeal(p, { plant: 0, meat: 1, fish: 0, dried: 0 }); dietDay(p); }
    /* a small child, whose chance of falling ill is high enough to count */
    const count = () => { let n = 0; for (let k = 0; k < 12000; k++) { p.sick = 0; p.food = 1; p.warmth = 1; illness(s, p, 0.5, "baby"); if (p.sick > 0) n++; } return n; };
    const poor = count();
    for (let d = 0; d < 60; d++) { noteMeal(p, { plant: 0.6, meat: 0.4, fish: 0, dried: 0 }); dietDay(p); }
    const good = count();
    expect(poor).toBeGreaterThan(good);
    p.sick = 0;
  });
});

describe("pottery comes to those with clay at hand and food going bad", () => {
  const { s } = fresh();
  it("is active in the tree with a story, and comes at the hearth; never where no clay is known", () => {
    const d = techByKey("pottery")!; expect(d.active).toBe(true); expect(d.story).toBeTruthy(); expect(d.near).toEqual(["clay"]);
    for (const k of ["kiln-firing", "grinding-grain", "porridge", "herb-lore"]) expect(techByKey(k)!.active, k).toBe(true);
    const b = s.bands.find(o => s.resources.knownNear(o.culture, o.x, o.y, 12, "clay")) ?? s.bands[0];
    const p = adults(s, b).sort((a, c) => c.traits[4] - a.traits[4])[0];
    learn(s, p, techIx("baskets"), null, "seen");
    b.problems[Problem.Storage] = 1; b.problems[Problem.Spoilage] = 1;
    const tries = (clay: boolean) => {
      const saved = s.resources.known.get(b.culture);
      if (!clay) s.resources.known.set(b.culture, new Set());
      let n = 0;
      for (let i = 0; i < 3000; i++) { if (inspire(s, p, St.Cook, { clayNear: clay })) { n++; p.know[d.id] = 0; p.from[d.id] = 0; p.knownIds = p.knownIds.filter(x => x !== d.id); s.ideas[d.id].knowers = 0; b.can[d.id] = 0; } }
      if (!clay && saved) s.resources.known.set(b.culture, saved);
      return n;
    };
    expect(tries(false)).toBe(0);
    expect(tries(true)).toBeGreaterThan(3);
    const before = s.events.length;
    discover(s, p, d.id, St.Cook, { clayNear: true });
    const e = s.events[before];
    expect(e.kind).toBe("discover"); expect(e.text).toContain(p.name); expect(e.text).toContain("pot"); expect(e.text).not.toContain("{");
  });
});
