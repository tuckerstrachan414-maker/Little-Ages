import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { St, type Person } from "../src/sim/people/person.ts";
import { homeOf, type Band } from "../src/sim/people/band.ts";
import { Idea, learn, knows, practice } from "../src/sim/people/ideas.ts";
import { techIx, techByKey, DURING, TECH_COUNT } from "../src/sim/tech/tree.ts";
import { quality, qualityOf, qualityFor, passRefine, carryRefine, practiced, mostRefined } from "../src/sim/tech/refine.ts";
import { techPanel, techNode } from "../src/sim/tech/summary.ts";
import { harvestSpell, seedLine, addWork, Work } from "../src/sim/people/works.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  Refinement: a people gets better at what it does, without end but ever more slowly; the
  better way passes on with teaching and with people who move between peoples; yields grow
  with it. And the three ways of this checkpoint that live by it: the bow, the sickle and
  seed kept for the sowing.
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
const know = (s: Society, p: Person, key: string) => { if (!knows(p, techIx(key))) learn(s, p, techIx(key), null, "seen"); };

describe("refinement", () => {
  it("every people starts at nothing, and rises with practice, ever more slowly", () => {
    const { s } = fresh();
    expect(s.refine.size).toBe(s.cultures.length);
    for (const c of s.cultures) { expect(s.refine.get(c.id)!.length).toBe(TECH_COUNT); expect(quality(s, c.id, Idea.Blades)).toBe(1); }
    const b = s.bands[0], p = grown(s, b)[0];
    know(s, p, "pottery");
    const ix = techIx("pottery"), r = s.refine.get(b.culture)!;
    expect(r[ix]).toBe(0);
    practice(s, p, ix, 0.02);
    expect(r[ix]).toBeGreaterThan(0);
    expect(s.uses.get(b.culture)![ix]).toBe(1);
    /* the first hundred teach more than the next hundred */
    const at = (n: number) => { for (let k = 0; k < n; k++) practice(s, p, ix, 0.02); return r[ix]; };
    const r0 = r[ix], r1 = at(200), r2 = at(200), r3 = at(2000);
    expect(r1 - r0).toBeGreaterThan(r2 - r1);
    expect(r3).toBeGreaterThan(r2);
    /* nothing happens for what someone does not know */
    const q = grown(s, b)[1]; q.know[ix] = 0;
    const before = r[ix]; practice(s, q, ix, 0.02); expect(r[ix]).toBe(before);
    practiced(s, q, ix, 0.02); expect(r[ix]).toBe(before);
    /* quality grows with the logarithm of the level, and is the same for everyone of that people */
    expect(quality(s, b.culture, ix)).toBeGreaterThan(1);
    expect(qualityOf(s, p, ix)).toBe(quality(s, b.culture, ix));
    expect(qualityFor(s, b.id, ix)).toBe(quality(s, b.culture, ix));
    expect(qualityFor(s, 99999, ix)).toBe(1);
    const lvl = r[ix]; expect(quality(s, b.culture, ix)).toBeCloseTo(1 + 0.22 * Math.log2(1 + lvl), 6);
    const top = mostRefined(s, 3); expect(top[0][0]).toBe(b.culture); expect(top[0][1]).toBe(ix);
  });
  it("passes to another people, most of it, with whoever learns the thing from them or goes to live among them", () => {
    const { s } = fresh();
    const a = s.bands[0], other = s.bands.find(o => o.culture !== a.culture)!;
    expect(other).toBeTruthy();
    const teacher = grown(s, a)[0], learner = grown(s, other)[0];
    know(s, teacher, "pottery");
    const ix = techIx("pottery");
    for (let k = 0; k < 500; k++) practice(s, teacher, ix, 0.02);
    const lvl = s.refine.get(a.culture)![ix]; expect(lvl).toBeGreaterThan(0.5);
    expect(s.refine.get(other.culture)![ix]).toBe(0);
    learn(s, learner, ix, teacher, "shown");
    expect(s.refine.get(other.culture)![ix]).toBeCloseTo(lvl * 0.6, 6);
    /* a better way is never lost to a worse one */
    passRefine(s, other.culture, a.culture, ix);
    expect(s.refine.get(a.culture)![ix]).toBe(lvl);
    /* a mover carries what they know well */
    const third = s.bands.find(o => o.culture !== a.culture && o.culture !== other.culture);
    if (third) {
      know(s, teacher, "wells"); for (let k = 0; k < 100; k++) practice(s, teacher, techIx("wells"), 0.02);
      teacher.know[ix] = 0.2;
      carryRefine(s, teacher, a.culture, third.culture);
      expect(s.refine.get(third.culture)![techIx("wells")]).toBeGreaterThan(0);
      expect(s.refine.get(third.culture)![ix]).toBe(0);
      s.moveTo(teacher, third);
      expect(teacher.band).toBe(third.id);
    }
  });
  it("the panel and the node card carry it", () => {
    const { s } = fresh();
    const b = s.bands[0], p = grown(s, b)[0];
    know(s, p, "pottery");
    const ix = techIx("pottery");
    for (let k = 0; k < 300; k++) practice(s, p, ix, 0.02);
    const panel = techPanel(s, { kind: "people", id: b.culture });
    expect(panel.refine[ix]).toBeGreaterThan(0);
    expect(techPanel(s, { kind: "world", id: 0 }).refine[ix]).toBe(panel.refine[ix]);
    const node = techNode(s, ix, { kind: "people", id: b.culture })!;
    expect(node.refine!.level).toBe(panel.refine[ix]); expect(node.refine!.uses).toBe(300); expect(node.refine!.best?.id).toBe(p.id);
  });
});

describe("the bow, the sickle and seed kept for the sowing", () => {
  it("are alive in the tree, and come to mind at a miss, at a slow harvest, and bringing in a crop of one's own", () => {
    for (const k of ["bow-and-arrow", "sickle-harvest", "seed-selection"]) { const d = techByKey(k)!; expect(d.active, k).toBe(true); expect(d.story, k).toBeTruthy(); expect(d.spark, k).toBeGreaterThan(0); }
    expect(DURING[St.Stalk]).toContain(techIx("bow-and-arrow"));
    expect(DURING[St.Gather]).toContain(techIx("sickle-harvest")); expect(DURING[St.Gather]).toContain(techIx("seed-selection"));
    expect(techByKey("bow-and-arrow")!.ctx).toEqual(["missed"]); expect(techByKey("sickle-harvest")!.ctx).toEqual(["slow"]); expect(techByKey("seed-selection")!.ctx).toEqual(["harvest"]);
    expect(techByKey("sickle-harvest")!.near).toEqual(["flint"]);
  });
  it("a sickle brings the harvest in faster, and chosen seed tames the line faster", () => {
    const { s } = fresh();
    const b = s.bands[0], p = grown(s, b)[0];
    expect(harvestSpell(p)).toBe(4.5);
    know(s, p, "blades"); know(s, p, "planting"); know(s, p, "sickle-harvest");
    expect(harvestSpell(p)).toBeCloseTo(2.8, 6);
    const home = homeOf(p, s.byId, s.time);
    const w = addWork(s, { kind: Work.Plot, x: b.x + 3, y: b.y + 3, wx: 0, wy: 0, band: b.id, home, by: p.id, t: s.time, state: 1, food: 20, crop: "wild grain", ripe: s.time, tame: 0 });
    seedLine(s, p, w);
    expect(b.seed["wild grain"]).toBeCloseTo(0.025, 6);
    know(s, p, "seed-selection");
    w.tame = 0.025; seedLine(s, p, w);
    expect(b.seed["wild grain"]).toBeCloseTo(0.065, 6);
  });
});
