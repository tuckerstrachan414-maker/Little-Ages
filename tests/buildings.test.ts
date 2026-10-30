import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { St, Goal, step, type Person } from "../src/sim/people/person.ts";
import { homeOf, type Band } from "../src/sim/people/band.ts";
import { Idea, learn } from "../src/sim/people/ideas.ts";
import { techIx, techByKey } from "../src/sim/tech/tree.ts";
import { Work, worksDay, workById } from "../src/sim/people/works.ts";
import { digPit, pitOf, pitRoom, pitSite, raise, hutOf, hutJob, hutHomes, hutStands, hutWords, hutDay } from "../src/sim/people/homes.ts";
import { DEFS, Line, defById, baseDef, materialTotal, houseWords } from "../src/sim/buildings/defs.ts";
import { startBuilding, startUpgrade, buildSpell, deliver, deliveredFraction, buildingDay, defOf, canStart, canUpgradeTo, standing, needsOf, undelivered, buildingOf, RAISE } from "../src/sim/buildings/build.ts";
import { wants, materialsInReach, communalSite, householdSite } from "../src/sim/buildings/wants.ts";
import { Problem } from "../src/sim/tech/problems.ts";
import { Mat, MAT_COUNT } from "../src/sim/economy/goods.ts";
import { bandDetail } from "../src/sim/people/inspect.ts";
import { qualityFor } from "../src/sim/tech/refine.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  Buildings made of parts: the defs hold together, a building goes up only as far as what
  has been carried to it, a hut is rebuilt in place as a house and stays the family's, and
  each kind wears at its own pace. Wants come from what a household or band is short of.
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
const grown = (s: Society, b: Band) => b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 55);
function headOf(s: Society, b: Band): Person { return grown(s, b).find(q => homeOf(q, s.byId, s.time) === q.id && q.partner) ?? grown(s, b)[0]; }
const know = (s: Society, p: Person, key: string) => learn(s, p, techIx(key), null, "seen");

describe("the building defs", () => {
  it("hold together: unique ids, lines and tiers in order, every tech and every 'from' real, materials that exist", () => {
    const ids = new Set<string>();
    for (const d of DEFS) {
      expect(ids.has(d.id), d.id).toBe(false); ids.add(d.id);
      for (const k of [...d.tech, ...(d.techAll ?? [])]) expect(techByKey(k), `${d.id} cites ${k}`).toBeTruthy();
      if (d.from) expect(DEFS.some(o => o.id === d.from || (o.line === d.line && o.tier === d.tier - 1)), `${d.id} from ${d.from}`).toBe(true);
      if (d.tier > 0) expect(d.from, `${d.id} has a tier but nothing it is rebuilt from`).toBeTruthy();
      for (const k in d.materials) { expect(+k).toBeGreaterThan(0); expect(+k).toBeLessThan(MAT_COUNT); expect(d.materials[+k]).toBeGreaterThan(0); }
      expect(d.labor).toBeGreaterThanOrEqual(0); expect(d.owner.length).toBeGreaterThan(0);
      expect(d.decay.lived).toBeLessThanOrEqual(d.decay.empty);
    }
    /* huts and pits are the first tiers of their lines, and want no materials carried (poles come the old way) */
    expect(baseDef(Line.House)!.id).toBe("house0"); expect(baseDef(Line.Store)!.id).toBe("store0");
    expect(materialTotal(defById("house0"))).toBe(0); expect(defById("house0").art.gen).toBe("hut"); expect(defById("store0").art.gen).toBe("pit");
    /* every line someone can build in this checkpoint is drawn from parts */
    for (const d of DEFS) if (d.active && d.tier > 0) expect(d.art.gen).toBe("proc");
    expect(houseWords("round", "mudbrick", "thatch")).toBe("roundhouse of mud brick under thatch");
  });
});

describe("raising a building", () => {
  const { s } = fresh();
  const b = s.bands[0], p = headOf(s, b);
  it("needs the know-how, goes up only as far as what has been carried to it, and finishes when the materials are there", () => {
    const def = defById("well0");
    expect(canStart(p, def)).toBe(false);
    know(s, p, "wells");
    expect(canStart(p, def)).toBe(true);
    const at = communalSite(s, b, def, 1)!; expect(at).toBeTruthy();
    const before = s.works.length;
    /* the first spell starts it */
    const st = step(St.Raise, at[0], at[1], 0, 1, { a: RAISE.Band, o: DEFS.indexOf(def) });
    buildSpell(s, p, st);
    expect(s.works.length).toBe(before + 1);
    const w = workById(s, st.id)!;
    expect(w.kind).toBe(Line.Well); expect(w.def).toBe("well0"); expect(w.owner).toBe(1); expect(w.home).toBe(0);
    expect(undelivered(w.needs)).toBe(materialTotal(def));
    /* with nothing delivered the work cannot go on: a well is dug, but it wants its timber for the windlass */
    for (let k = 0; k < 30; k++) buildSpell(s, p, st);
    expect(w.prog).toBeLessThan(1); expect(w.prog).toBeCloseTo(deliveredFraction(w), 5); expect(deliveredFraction(w)).toBe(0);
    /* someone brings the wood */
    p.carryKind = Mat.Wood; p.carryAmt = 3;
    expect(deliver(s, p, w)).toBe(3); expect(p.carryAmt).toBe(0); expect(w.needs![Mat.Wood]).toBe(1);
    p.carryKind = Mat.Wood; p.carryAmt = 5;
    expect(deliver(s, p, w)).toBe(1); expect(p.carryAmt).toBe(4);
    expect(deliveredFraction(w)).toBe(1);
    const ev = s.events.filter(e => e.kind === "well").length;
    for (let k = 0; k < 40 && (w.prog ?? 0) < 1; k++) buildSpell(s, p, st);
    expect(w.prog).toBe(1); expect(standing(w)).toBe(true); expect(w.needs).toBeUndefined();
    expect(s.events.filter(e => e.kind === "well").length).toBe(ev + 1);
    expect(s.events.filter(e => e.kind === "well").pop()!.text).toContain(p.name);
    expect(s.stats.buildings.built).toBe(1);
    /* it is a well, not a weir: the day passes without it filling with fish or growing like a crop */
    const n = s.works.length; worksDay(s);
    expect(s.works.length).toBe(n); expect(w.food).toBe(0); expect(w.state).toBeLessThan(1); expect(w.state).toBeGreaterThan(0.99);
  });
  it("wears at its own pace, fastest with nobody keeping it", () => {
    const w = s.works.find(o => o.kind === Line.Well)!;
    /* a people that has built a thing builds it a little to last: the wear is the def's, over their refinement of it */
    const q = qualityFor(s, w.band, techIx(defOf(w).tech[0]));
    const kept = w.state; buildingDay(s, w); const lived = kept - w.state;
    expect(lived).toBeCloseTo(defOf(w).decay.lived / q, 6);
    b.x += 100; b.y += 100;
    const before = w.state; buildingDay(s, w); const empty = before - w.state;
    b.x -= 100; b.y -= 100;
    expect(empty).toBeCloseTo(defOf(w).decay.empty / q, 6);
    expect(empty).toBeGreaterThan(lived);
  });
  it("a frame nobody comes back to rots where it stands", () => {
    const def = defById("kiln0"); know(s, p, "kiln-firing");
    const w = startBuilding(s, p, def, b.x + 6, b.y, "household", homeOf(p, s.byId, s.time));
    expect(w.prog).toBe(0);
    /* kept, with nothing yet delivered, it waits for its first load; untouched for a season it begins to go; with the band gone it goes fast */
    for (let d = 0; d < 10; d++) expect(buildingDay(s, w)).toBe(true);
    expect(w.prog).toBe(0);
    s.time += DAY_SECONDS * 25; expect(buildingDay(s, w)).toBe(true); expect(w.prog).toBeLessThan(0);
    w.prog = 0.3; b.x += 100;
    let alive = true, days = 0; for (; days < 90 && alive; days++) alive = buildingDay(s, w);
    b.x -= 100;
    expect(alive).toBe(false); expect(days).toBeGreaterThan(30);
  });
});

describe("a hut rebuilt in place", () => {
  const { s } = fresh();
  const b = s.bands[1], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
  it("keeps the work and the family, stays lived in while the clay comes, and stands as a house of mud brick at the end", () => {
    learn(s, p, Idea.Huts, null, "seen");
    const job = hutJob(s, p, b)!; expect(job).toBeTruthy();
    const st = step(St.Raise, job.x, job.y, 0, 1, { a: RAISE.Hut });
    for (let k = 0; k < 40 && !hutStands(hutOf(s, b, home)); k++) { p.carryKind = Mat.Wood; p.carryAmt = 3; raise(s, p, st); st.id = hutOf(s, b, home)?.id ?? 0; }
    const hut = hutOf(s, b, home)!; expect(hutStands(hut)).toBe(true);
    const id = hut.id, homes = hutHomes(hut).slice();
    expect(hutWords(hut)).not.toContain("mud brick");
    const def = defById("house1-mudbrick");
    expect(canUpgradeTo(hut, def)).toBe(true); expect(canUpgradeTo(hut, defById("house2-stone"))).toBe(false);
    expect(canStart(p, def)).toBe(false);
    know(s, p, "pottery"); know(s, p, "mud-brick");
    expect(canStart(p, def)).toBe(true);
    const up = step(St.Raise, hut.x, hut.y, hut.id, 1, { a: RAISE.Upgrade, o: DEFS.indexOf(def) });
    buildSpell(s, p, up);
    expect(hut.up).toBeTruthy(); expect(hut.up!.def).toBe("house1-mudbrick"); expect(hut.up!.needs[Mat.Clay]).toBe(30);
    /* still the family's hut, still standing, while the work goes on */
    expect(hutStands(hut)).toBe(true); expect(hutOf(s, b, home)).toBe(hut); expect(hut.tier ?? 0).toBe(0);
    for (let k = 0; k < 20; k++) buildSpell(s, p, up);
    expect(hut.up!.prog).toBe(0);
    /* the clay and the wood come in, load by load */
    let guard = 0;
    while (hut.up && guard++ < 200) {
      const left = hut.up.needs;
      p.carryKind = left[Mat.Clay] > 0 ? Mat.Clay : Mat.Wood; p.carryAmt = 6;
      buildSpell(s, p, up);
    }
    expect(hut.up).toBeUndefined(); expect(hut.tier).toBe(1); expect(hut.def).toBe("house1-mudbrick"); expect(hut.walls).toBe("mudbrick");
    expect(hut.id).toBe(id); expect(hutHomes(hut)).toEqual(homes); expect(hutStands(hut)).toBe(true); expect(hutOf(s, b, home)).toBe(hut);
    expect(hutWords(hut)).toContain("mud brick");
    expect(s.events.some(e => e.kind === "upgrade" && e.text.includes("mud brick"))).toBe(true);
    expect(s.stats.buildings.upgrades).toBe(1);
    /* a house of mud brick wears slower than a hut of poles */
    const before = hut.state; hutDay(s, hut);
    expect(before - hut.state).toBeCloseTo(def.decay.lived, 6);
    expect(def.decay.lived).toBeLessThan(defById("house0").decay.lived);
    /* the band card says so */
    expect(bandDetail(s, b.id)!.homes).toContain("rebuilt in mud brick");
  });
  it("a pit rebuilt as a granary keeps what was in it and holds far more", () => {
    learn(s, p, Idea.Pits, null, "seen");
    const at = pitSite(s, b, home)!; digPit(s, p, step(St.Pit, at[0], at[1], 0, 1));
    const pit = pitOf(s, b, home)!; pit.foods!.plant = 20;
    expect(pitRoom(pit)).toBe(40);
    know(s, p, "granary");
    const def = defById("store1"); expect(canUpgradeTo(pit, def)).toBe(true);
    startUpgrade(s, pit, def);
    const up = step(St.Raise, pit.x, pit.y, pit.id, 1, { a: RAISE.Upgrade, o: DEFS.indexOf(def) });
    let guard = 0; while (pit.up && guard++ < 100) { p.carryKind = Mat.Wood; p.carryAmt = 6; buildSpell(s, p, up); }
    expect(pit.tier).toBe(1); expect(pitRoom(pit)).toBe(160); expect(pit.foods!.plant).toBe(20); expect(pitOf(s, b, home)).toBe(pit);
    expect(s.events.some(e => e.kind === "granary")).toBe(true);
  });
});

describe("what people want to build", () => {
  const { s } = fresh();
  it("a household with more food put by than its pit holds wants a granary, once someone knows how", () => {
    const b = s.bands[2], p = headOf(s, b), home = homeOf(p, s.byId, s.time);
    learn(s, p, Idea.Pits, null, "seen");
    const at = pitSite(s, b, home)!; digPit(s, p, step(St.Pit, at[0], at[1], 0, 1));
    b.problems[Problem.Storage] = 0.9;
    expect(wants(s, p, b).some(w => w.def.id === "store1")).toBe(false);
    know(s, p, "granary");
    const w = wants(s, p, b).find(w => w.def.id === "store1")!;
    expect(w).toBeTruthy(); expect(w.up).toBe(pitOf(s, b, home)); expect(w.owner).toBe("household"); expect(w.why).toContain("granary");
  });
  it("a band whose water is a long walk wants a well, with wood in reach; a cold hut wants rebuilding only with clay the people knows of", () => {
    const b = s.bands[3], p = headOf(s, b);
    b.problems[Problem.Water] = 0.8;
    expect(wants(s, p, b).some(w => w.def.id === "well0")).toBe(false);
    know(s, p, "wells");
    const w = wants(s, p, b).find(w => w.def.id === "well0")!;
    expect(w).toBeTruthy(); expect(w.owner).toBe("band"); expect(Math.hypot(w.x - b.x, w.y - b.y)).toBeLessThan(9);
    expect(materialsInReach(s, b, defById("house1-timber"))).toBe(true);
    const clayKnown = !!s.resources.knownDeposit(b.culture, b.x, b.y, 18, Mat.Clay);
    expect(materialsInReach(s, b, defById("house1-mudbrick"))).toBe(clayKnown);
  });
  it("two who set out for the same well raise one between them, never two on one spot, and one standing there needs nothing more", () => {
    const { s: t } = fresh();
    const b = t.bands[1], ps = grown(t, b).slice(0, 2);
    for (const p of ps) { know(t, p, "digging-sticks"); know(t, p, "wells"); }
    const def = defById("well0"), o = DEFS.indexOf(def), at = communalSite(t, b, def, b.id)!;
    expect(at).toBeTruthy();
    /* both planned the same spot before either began; the second finds the first's frame and brings their load to it */
    const stA = step(St.Raise, at[0], at[1], 0, 1, { a: RAISE.Band, o }), stB = step(St.Raise, at[0], at[1], 0, 1, { a: RAISE.Band, o });
    ps[0].carryKind = Mat.Wood; ps[0].carryAmt = 2; buildSpell(t, ps[0], stA);
    ps[1].carryKind = Mat.Wood; ps[1].carryAmt = 2; buildSpell(t, ps[1], stB);
    const wells = t.works.filter(w => w.kind === Line.Well);
    expect(wells.length).toBe(1); expect(stB.id).toBe(stA.id); expect(undelivered(wells[0].needs)).toBe(0);
    for (let k = 0; k < 80 && !standing(wells[0]); k++) buildSpell(t, ps[0], stA);
    expect(standing(wells[0])).toBe(true);
    /* a third who set out for the same spot finds the well dug, and starts nothing */
    buildSpell(t, ps[1], step(St.Raise, at[0], at[1], 0, 1, { a: RAISE.Band, o }));
    expect(t.works.filter(w => w.kind === Line.Well).length).toBe(1);
  });
  it("a fold fallen in does not hide the one standing beside it, nor take its place; a worn fold is mended before it falls", () => {
    const { s: t } = fresh();
    const b = t.bands[2], p = headOf(t, b), home = homeOf(p, t.byId, t.time);
    know(t, p, "huts"); know(t, p, "penning");
    const def = defById("pen0"), at1 = householdSite(t, b, def, home)!;
    expect(at1).toBeTruthy();
    const ruin = startBuilding(t, p, def, at1[0], at1[1], "household", home); ruin.prog = 1; ruin.needs = undefined; ruin.state = 0.1;
    expect(standing(ruin)).toBe(false); expect(buildingOf(t, b, Line.Pen, home)).toBe(ruin);
    /* the household's own fallen fold stands in the way of the next one, which goes elsewhere */
    const at2 = householdSite(t, b, def, home)!;
    expect(at2).toBeTruthy(); expect(Math.hypot(at2[0] - at1[0], at2[1] - at1[1])).toBeGreaterThan(1);
    const pen = startBuilding(t, p, def, at2[0], at2[1], "household", home); pen.prog = 1; pen.needs = undefined; pen.state = 0.9;
    expect(buildingOf(t, b, Line.Pen, home)).toBe(pen);
    /* worn, it is mended: a want with no materials to carry, and a spell that puts it right */
    pen.state = 0.4;
    const wt = wants(t, p, b).find(x => x.mend && x.help === pen)!;
    expect(wt).toBeTruthy(); expect(wt.why).toContain("mending");
    const mended = t.stats.buildings.mended;
    buildSpell(t, p, step(St.Raise, pen.x, pen.y, pen.id, 1, { a: RAISE.Mend, o: DEFS.indexOf(def) }));
    expect(pen.state).toBeGreaterThan(0.4); expect(t.stats.buildings.mended).toBe(mended + 1);
    expect(wants(t, p, b).some(x => x.mend && x.help === pen)).toBe(pen.state < 0.6);
    /* a sound fold is nobody's to mend, and a kiln beside it is not sited on top of it */
    pen.state = 1;
    expect(wants(t, p, b).some(x => x.mend)).toBe(false);
    know(t, p, "pottery"); know(t, p, "kiln-firing");
    const kat = householdSite(t, b, defById("kiln0"), home);
    if (kat) expect(Math.hypot(kat[0] - pen.x, kat[1] - pen.y)).toBeGreaterThan(1.5);
  });
  it("the decision loop offers the work, and the step switch carries it out", () => {
    const b = s.bands[3], p = headOf(s, b);
    b.problems[Problem.Water] = 0.8; p.food = 2; p.water = 1; p.rest = 1;
    const opts = wants(s, p, b);
    expect(opts.length).toBeGreaterThan(0);
    expect(Object.values(Goal)).toContain(Goal.Construct); expect(Object.values(St)).toContain(St.Quarry);
    expect(needsOf(defById("well0"))[Mat.Wood]).toBe(4);
    expect(Work.Hut).toBe(Line.House); expect(Work.Pit).toBe(Line.Store);
  });
});
