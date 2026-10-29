import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { St, step, type Person } from "../src/sim/people/person.ts";
import { homeOf, type Band } from "../src/sim/people/band.ts";
import { Idea, learn } from "../src/sim/people/ideas.ts";
import { techIx, techByKey, Era } from "../src/sim/tech/tree.ts";
import { Problem } from "../src/sim/tech/problems.ts";
import { addWork, Work } from "../src/sim/people/works.ts";
import { raise, hutOf, hutStands, hutJob } from "../src/sim/people/homes.ts";
import { villagesDay, type Village } from "../src/sim/people/villages.ts";
import { settlementsDay, cultureAge, listenedAt, villageBuildings, TIER_NAMES, isChief } from "../src/sim/people/settlements.ts";
import { wants } from "../src/sim/buildings/wants.ts";
import { Line } from "../src/sim/buildings/defs.ts";
import { standing, buildSpell, RAISE, OWNER } from "../src/sim/buildings/build.ts";
import { villageDetail, bandDetail } from "../src/sim/people/inspect.ts";
import { Mat } from "../src/sim/economy/goods.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  Settlements: tiers from what stands and who lives there, a chief from whom the village's
  grown-ups listen to across its bands, the chief's call to dig a well, and a people's age.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(bands = 8) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 2, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands }, t0);
  return { s };
}
const grown = (s: Society, b: Band) => b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 55);
const know = (s: Society, p: Person, key: string) => learn(s, p, techIx(key), null, "seen");
/** Raises a hut for a household the quick way. */
function hutFor(s: Society, b: Band, p: Person): void {
  learn(s, p, Idea.Huts, null, "seen");
  const home = homeOf(p, s.byId, s.time);
  for (let k = 0; k < 60 && !hutStands(hutOf(s, b, home)); k++) { const job = hutJob(s, p, b); if (!job) break; const st = step(St.Raise, job.x, job.y, job.hut?.id ?? 0, 1, { a: 0 }); p.carryKind = Mat.Wood; p.carryAmt = 3; raise(s, p, st); }
}
/** Makes a village of a band: huts for three households, a year's stay, and the day's pass. */
function villageOf(s: Society, b: Band): Village {
  const heads = [...new Set(grown(s, b).map(q => homeOf(q, s.byId, s.time)))].slice(0, 4);
  for (const h of heads) { const p = s.byId.get(h)!; hutFor(s, b, p); }
  b.movedAt = s.time - DAY_SECONDS * 41;
  villagesDay(s);
  const v = s.villages.find(o => o.bands.includes(b.id))!;
  expect(v).toBeTruthy();
  return v;
}

describe("tiers", () => {
  it("a village is a hamlet until thirty people live there, a town once a hundred share a well and a kiln", () => {
    const { s } = fresh();
    const b = s.bands.slice().sort((a, c) => c.members.length - a.members.length)[0];
    const v = villageOf(s, b);
    settlementsDay(s);
    expect(v.tier).toBe(b.members.length >= 30 ? 1 : 0);
    expect(TIER_NAMES[v.tier]).toBeTruthy();
    /* more people */
    v.pop = 40; const before = s.events.length; settlementsDay(s); villagesDay(s); settlementsDay(s);
    v.pop = 40; settlementsDay(s);
    expect(v.tier).toBe(1);
    expect(s.events.slice(before).some(e => e.kind === "tier" && e.text.includes("grown into a village"))).toBe(true);
    /* a town: a hundred people, a well and a granary the village shares, a kiln */
    const p = grown(s, b)[0], home = homeOf(p, s.byId, s.time);
    const mk = (line: number, owner: number, extra: Partial<Work> = {}) => addWork(s, { kind: line, x: v.x + 4, y: v.y + 4 + line, wx: 0, wy: 0, band: b.id, home: owner ? 0 : home, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, tier: line === Line.Store ? 1 : 0, def: line === Line.Well ? "well0" : line === Line.Store ? "store1" : "kiln0", owner, ...extra });
    mk(Line.Well, OWNER.settlement); mk(Line.Store, OWNER.settlement, { foods: { plant: 0, meat: 0, fish: 0, dried: 0 }, size: 160 }); mk(Line.Kiln, OWNER.household);
    const built = villageBuildings(s, v);
    expect(built.communal.length).toBe(2); expect(built.crafts).toBe(1);
    v.pop = 120; settlementsDay(s);
    expect(v.tier).toBe(2);
    expect(s.events.some(e => e.kind === "tier" && e.text.includes("grown into a town"))).toBe(true);
    expect(villageDetail(s, v.id)!.tier).toBe(2);
    /* and back down when the people are gone */
    v.pop = 40; settlementsDay(s);
    expect(v.tier).toBe(1);
    expect(s.events.some(e => e.kind === "tier" && e.text.includes("dwindled"))).toBe(true);
  });
});

describe("the chief", () => {
  it("is the one most of the village's grown-ups listen to, across its bands, and only with a clear following", () => {
    const { s } = fresh();
    const b = s.bands.slice().sort((a, c) => c.members.length - a.members.length)[0];
    const v = villageOf(s, b);
    const adults = grown(s, b), top = adults[0];
    /* nobody listens to anyone in particular: no chief */
    for (const q of adults) q.follows = q.id;
    settlementsDay(s);
    expect(v.chief).toBe(0);
    /* most of them go along with one person */
    const all = b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 16);
    for (const q of all) q.follows = q === top ? top.id : top.id;
    const before = s.events.length;
    settlementsDay(s);
    expect(v.chief).toBe(top.id);
    expect(isChief(s, top)).toBe(true);
    expect(listenedAt(s, v)[0].id).toBe(top.id);
    const e = s.events.slice(before).find(e => e.kind === "chief")!;
    expect(e).toBeTruthy(); expect(e.text).toContain(top.name); expect(e.text).toContain(v.name);
    expect(villageDetail(s, v.id)!.chief?.id).toBe(top.id);
    /* a chief is not swapped for a slightly bigger following, only a clearly bigger one */
    const rival = adults[1];
    const half = Math.ceil(all.length / 2);
    all.forEach((q, i) => { q.follows = i < half + 1 ? rival.id : top.id; });
    settlementsDay(s);
    expect(v.chief).toBe(top.id);
    for (const q of all) q.follows = rival.id;
    v.chiefSince = s.time - DAY_SECONDS * 20;
    settlementsDay(s);
    expect(v.chief).toBe(rival.id);
  });
  it("sets the village to digging a well when the water is far, and the villagers lend a hand", () => {
    const { s } = fresh();
    const b = s.bands.slice().sort((a, c) => c.members.length - a.members.length)[0];
    const v = villageOf(s, b);
    const all = b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 16), chief = grown(s, b)[0];
    for (const q of all) q.follows = chief.id;
    know(s, chief, "digging-sticks"); know(s, chief, "wells");
    for (const o of s.bands) o.problems[Problem.Water] = 0;
    b.problems[Problem.Water] = 0.9; b.water = [b.x + 12, b.y];
    const before = s.events.length;
    settlementsDay(s);
    expect(v.chief).toBe(chief.id);
    expect(v.call).toBeTruthy();
    const w = s.works.find(o => o.id === v.call!.work)!;
    expect(w.kind).toBe(Line.Well); expect(w.owner).toBe(OWNER.settlement); expect(w.prog).toBe(0);
    expect(s.events.slice(before).some(e => e.kind === "communal" && e.text.includes(chief.name) && e.text.includes("well"))).toBe(true);
    /* another villager sees the work to help with, more readily if they go along with the chief */
    const helper = all.find(q => q !== chief && s.age(q) < 60)!;
    const w1 = wants(s, helper, b).find(x => x.help === w)!;
    expect(w1).toBeTruthy(); expect(w1.owner).toBe("settlement");
    helper.follows = helper.id; s.rel(helper, chief.id).op = -0.5;
    const w2 = wants(s, helper, b).find(x => x.help === w)!;
    expect(w2.v).toBeLessThan(w1.v);
    /* the well is dug; the call is answered, and the chief is thought the more of */
    const st = step(St.Raise, w.x, w.y, w.id, 1, { a: RAISE.Settlement, o: 0 });
    const pr = chief.prestige;
    helper.carryKind = Mat.Wood; helper.carryAmt = 6;
    for (let k = 0; k < 60 && !standing(w); k++) buildSpell(s, helper, st);
    expect(standing(w)).toBe(true);
    settlementsDay(s);
    expect(v.call).toBeNull();
    expect(chief.prestige).toBeGreaterThan(pr);
    expect(v.communal).toContain(w.id);
    expect(villageDetail(s, v.id)!.call).toBe("");
  });
});

describe("a people's age", () => {
  it("is the highest era enough of them know; told when it changes", () => {
    const { s } = fresh();
    const c = s.cultures[s.bands[0].culture], bands = s.bands.filter(b => b.culture === c.id);
    expect(cultureAge(s, c.id)).toBe(Era.OldStone);
    expect(bandDetail(s, bands[0].id)!.age).toBe("Old Stone Age");
    const people = bands.flatMap(b => grown(s, b)).slice(0, 3);
    expect(people.length).toBe(3);
    for (const p of people) know(s, p, "pottery");
    for (const b of bands) { const { countBand } = require("../src/sim/people/ideas.ts"); countBand(s, b); }
    expect(cultureAge(s, c.id)).toBe(Era.NewStone);
    const before = s.events.length;
    settlementsDay(s);
    expect(c.age).toBe(Era.NewStone);
    const e = s.events.slice(before).find(e => e.kind === "age")!;
    expect(e).toBeTruthy(); expect(e.text).toContain("New Stone Age"); expect(e.text).toContain(c.lang.name);
    expect(bandDetail(s, bands[0].id)!.age).toBe("New Stone Age");
  });
  it("the building ways of this checkpoint are alive in the tree", () => {
    for (const k of ["granary", "mud-brick", "wattle-and-daub", "timber-framing"]) { const d = techByKey(k)!; expect(d.active, k).toBe(true); expect(d.story, k).toBeTruthy(); expect(d.during.length, k).toBeGreaterThan(0); }
  });
});
