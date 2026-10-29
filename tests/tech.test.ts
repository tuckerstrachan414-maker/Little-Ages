import { describe, it, expect } from "vitest";
import { TECHS, TECH_COUNT, Idea, DURING, HINT_BASE, packHint, unpackHint, validateTree, techIx, Branch, Era, BRANCH_NAMES, ERA_NAMES, eraOf } from "../src/sim/tech/tree.ts";
import { St } from "../src/sim/people/person.ts";
import { IDEAS, IDEA_COUNT } from "../src/sim/people/ideas.ts";

/*
  The tree of everything people might work out, as data. These check that it holds together
  (no node needs something that comes later, no loops, nothing active that can never come),
  that the first sixteen are exactly where they always were, and that the hints events carry
  survive at any size of tree.
*/

describe("the tree", () => {
  it("holds together", () => {
    expect(validateTree()).toEqual([]);
    expect(TECH_COUNT).toBeGreaterThan(300);
    expect(IDEAS).toBe(TECHS); expect(IDEA_COUNT).toBe(TECH_COUNT);
    const keys = new Set(TECHS.map(d => d.key)); expect(keys.size).toBe(TECH_COUNT);
    for (const d of TECHS) {
      expect(d.id).toBe(TECHS.indexOf(d));
      expect(d.name.length).toBeGreaterThan(1); expect(d.how.startsWith("how") || d.how.startsWith("which")).toBe(true);
      expect(d.branch).toBeGreaterThanOrEqual(0); expect(d.branch).toBeLessThan(BRANCH_NAMES.length);
      expect(d.era).toBeGreaterThanOrEqual(0); expect(d.era).toBeLessThan(ERA_NAMES.length);
      for (const n of d.needs) expect(n).not.toBe(d.id);
    }
    /* every branch and every age has something in it */
    for (let b = 0; b < BRANCH_NAMES.length; b++) expect(TECHS.some(d => d.branch === b)).toBe(true);
    for (let e = 0; e < ERA_NAMES.length; e++) expect(TECHS.some(d => d.era === e)).toBe(true);
    expect(Branch.Food).toBe(0); expect(Era.Space).toBe(ERA_NAMES.length - 1);
  });
  it("keeps the first sixteen where they have always been", () => {
    const old = ["keeping fire", "spear hunting", "fishing", "working hides", "setting snares", "making fire", "striking blades", "stone axes", "digging sticks", "weaving baskets", "fishing nets", "fish weirs", "drying meat", "planting", "storage pits", "building huts"];
    old.forEach((name, i) => expect(TECHS[i].name).toBe(name));
    expect(Idea).toEqual({ KeepFire: 0, Spear: 1, Fishing: 2, Hides: 3, Snares: 4, MakeFire: 5, Blades: 6, Axe: 7, Digging: 8, Baskets: 9, Nets: 10, Weirs: 11, Drying: 12, Planting: 13, Pits: 14, Huts: 15 });
    /* the old ways are the only things known at the start; nothing new is */
    expect(TECHS.filter(d => d.start).map(d => d.id)).toEqual([0, 1, 2, 3, 4]);
    /* the sixteen old ways and the nodes this checkpoint brings to life are active; everything else is only listed, and can never come to anyone */
    const ACTIVE = new Set(["pottery", "kiln-firing", "grinding-grain", "porridge", "herb-lore", "wells"]);
    for (const d of TECHS) { expect(d.active, d.key).toBe(d.id < 16 || ACTIVE.has(d.key)); if (!d.active) expect(d.spark).toBe(0); else if (!d.start) expect(d.spark).toBeGreaterThan(0); }
    /* what they build on, as before */
    expect(TECHS[Idea.MakeFire].needs).toEqual([Idea.KeepFire]); expect(TECHS[Idea.Blades].needs).toEqual([Idea.Spear]); expect(TECHS[Idea.Axe].needs).toEqual([Idea.Blades]);
    expect(TECHS[Idea.Nets].needs).toEqual([Idea.Fishing, Idea.Snares]); expect(TECHS[Idea.Weirs].needs).toEqual([Idea.Fishing]); expect(TECHS[Idea.Drying].needs).toEqual([Idea.KeepFire]);
    expect(TECHS[Idea.Planting].needs).toEqual([Idea.Digging]); for (const id of [Idea.Digging, Idea.Baskets, Idea.Pits, Idea.Huts]) expect(TECHS[id].needs).toEqual([]);
  });
  it("brings each idea to mind during the same work, in the same order, as before", () => {
    const old: Record<number, number[]> = {
      [St.Knap]: [Idea.MakeFire, Idea.Blades], [St.Kindle]: [Idea.MakeFire], [St.Craft]: [Idea.MakeFire],
      [St.Wood]: [Idea.Axe, Idea.Huts], [St.Gather]: [Idea.Digging, Idea.Baskets, Idea.Planting, Idea.Pits], [St.Fish]: [Idea.Nets, Idea.Weirs],
      [St.Butcher]: [Idea.Drying, Idea.Blades], [St.Cook]: [Idea.Drying],
    };
    /* the old ways come first in each list, in their old order; what is new to this checkpoint comes after them */
    for (const k of Object.keys(DURING).map(Number)) {
      const list = DURING[k] ?? [], legacy = list.filter(id => id < 16);
      expect(legacy, `step ${k}`).toEqual(old[k] ?? []);
      expect(list.slice(0, legacy.length), `step ${k}: the old ways first`).toEqual(legacy);
    }
    for (const k of Object.keys(old).map(Number)) expect((DURING[k] ?? []).filter(id => id < 16)).toEqual(old[k]);
  });
  it("packs a level and a node into one hint whatever the size of the tree", () => {
    expect(HINT_BASE).toBeGreaterThan(TECH_COUNT);
    for (const id of [0, 15, 99, 100, TECH_COUNT - 1]) for (const level of [0, 1, 2]) expect(unpackHint(packHint(level, id))).toEqual({ level, id });
    expect(techIx("pottery")).toBeGreaterThan(15);
    expect(() => techIx("time-travel")).toThrow();
  });
  it("tells a people's age from what it knows", () => {
    expect(eraOf(id => id < 16)).toBe(Era.OldStone);
    const pottery = techIx("pottery"), bronze = techIx("bronze-casting");
    expect(eraOf(id => id < 16 || id === pottery)).toBe(Era.NewStone);
    expect(eraOf(id => id === bronze)).toBe(Era.Bronze);
  });
});
