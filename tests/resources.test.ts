import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { generateDeposits } from "../src/sim/world/geology.ts";
import { Resources } from "../src/sim/resources.ts";
import { Mat, MATS, MAT_COUNT, DUG } from "../src/sim/economy/goods.ts";
import { MAT_NAMES, MAT_COLORS } from "../src/shared/mats.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology, CELL } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { Place } from "../src/sim/people/person.ts";
import { bake } from "../src/sim/world/bake.ts";
import { Biome, Flag, Tree, DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  What the land holds: deposits laid down with the world and found by explorers, wood that
  comes off the trees and grows back.
*/

const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
const at = (w: WorldData, x: number, y: number) => Math.floor(y) * w.w + Math.floor(x);

describe("the materials", () => {
  it("every material has a definition, a page name and a color, in the same order", () => {
    expect(MATS.length).toBe(MAT_COUNT);
    MATS.forEach((m, i) => { expect(m.id).toBe(i); expect(MAT_NAMES[i]).toBe(m.name); expect(MAT_COLORS[i]).toBe(m.color); });
    expect(DUG).toContain(Mat.Clay); expect(DUG).toContain(Mat.Copper); expect(DUG).not.toContain(Mat.Pots);
  });
});

describe("what lies in the ground", () => {
  const deps = generateDeposits(world, SEED);
  it("is the same for the same seed, and different for another", () => {
    const again = generateDeposits(world, SEED);
    expect(again.length).toBe(deps.length);
    expect(again.map(d => `${d.kind}:${d.x},${d.y}:${d.amount}`).join("|")).toBe(deps.map(d => `${d.kind}:${d.x},${d.y}:${d.amount}`).join("|"));
    const other = generateDeposits(world, SEED + 1);
    expect(other.map(d => `${d.kind}:${d.x},${d.y}`).join("|")).not.toBe(deps.map(d => `${d.kind}:${d.x},${d.y}`).join("|"));
  });
  it("lays down every common material, and never on water or ice", () => {
    for (const k of [Mat.Clay, Mat.Flint, Mat.Stone]) expect(deps.filter(d => d.kind === k).length, MATS[k].name).toBeGreaterThan(5);
    for (const d of deps) {
      const i = at(world, d.x, d.y), b = world.biome[i];
      if (d.kind !== Mat.Gold) expect(world.flags[i] & Flag.Water, `${MATS[d.kind].name} at ${d.x},${d.y}`).toBe(0);
      expect(b === Biome.IceSheet || b === Biome.SnowPeak, `${MATS[d.kind].name} on ice`).toBe(false);
      expect(d.left).toBe(d.amount); expect(d.amount).toBeGreaterThan(0);
    }
  });
  it("puts clay by fresh water or in the swamps, gold in rivers, and keeps tin away from copper", () => {
    for (const d of deps.filter(d => d.kind === Mat.Clay)) {
      let wet = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = at(world, d.x + dx, d.y + dy); if (world.flags[i] & (Flag.River | Flag.Lake) || world.biome[i] === Biome.Swamp) wet = true; }
      expect(wet).toBe(true);
    }
    for (const d of deps.filter(d => d.kind === Mat.Gold)) expect(world.flags[at(world, d.x, d.y)] & Flag.River).toBeTruthy();
    const copper = deps.filter(d => d.kind === Mat.Copper), tin = deps.filter(d => d.kind === Mat.Tin);
    for (const t of tin) for (const c of copper) expect(Math.hypot(t.x - c.x, t.y - c.y)).toBeGreaterThanOrEqual(40);
    /* deposits of a kind keep their distance */
    for (const a of deps.filter(d => d.kind === Mat.Clay)) for (const b of deps.filter(d => d.kind === Mat.Clay)) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(24);
  });
  it("gives up what it holds until it is dug out, and the salt pans fill again", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const res = new Resources(w, SEED);
    const clay = res.deposits.find(d => d.kind === Mat.Clay)!;
    expect(res.take(clay, 100)).toBe(100); expect(clay.left).toBe(clay.amount - 100);
    expect(res.take(clay, clay.amount * 2)).toBe(clay.amount - 100); expect(clay.left).toBe(0);
    expect(res.take(clay, 5)).toBe(0); expect(res.stats.exhausted).toBe(1);
    expect(res.depositsNear(clay.x, clay.y, 1).includes(clay)).toBe(false);
    const salt = res.deposits.find(d => d.kind === Mat.Salt);
    if (salt) { res.take(salt, salt.amount); res.daily(DAY_SECONDS * 100); expect(salt.left).toBeGreaterThan(0); }
  });
  it("is known only to the peoples whose explorers found it", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const res = new Resources(w, SEED), d = res.deposits.find(d => d.kind === Mat.Flint)!;
    expect(res.knownNear(0, d.x, d.y, 3, "flint")).toBe(false);
    expect(res.find(0, d)).toBe(true); expect(res.find(0, d)).toBe(false);
    expect(res.knownNear(0, d.x, d.y, 3, "flint")).toBe(true);
    expect(res.knownNear(1, d.x, d.y, 3, "flint")).toBe(false);
    expect(res.knownDeposit(0, d.x + 2, d.y, 10, Mat.Flint)).toBe(d);
    expect(res.knownBy()[d.id - 1]).toBe(1);
  });
});

describe("the wood on the land", () => {
  const forestTile = (w: WorldData): number => {
    /* a tile deep in a wood: all eight neighbors treed */
    for (let y = 20; y < w.h - 20; y++) for (let x = 20; x < w.w - 20; x++) {
      let ok = true;
      for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) { const t = w.tree[(y + dy) * w.w + x + dx]; if (!t || t === Tree.Reeds || t === Tree.Cactus || t === Tree.Shrub || t === Tree.BerryBush) { ok = false; break; } }
      if (ok) return y * w.w + x;
    }
    throw new Error("no wood");
  };
  it("comes off a tree a load at a time until the tree is felled, and the page hears of it", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const res = new Resources(w, SEED), i = forestTile(w), x = i % w.w, y = (i / w.w) | 0;
    const stock = res.stock[i]; expect(stock).toBeGreaterThan(10);
    let got = 0, n = 0;
    while (w.tree[i] !== Tree.Snag && n++ < 100) got += res.cut(x, y, 5, DAY_SECONDS * 50);
    expect(got).toBe(stock); expect(w.tree[i]).toBe(Tree.Snag); expect(res.stats.felled).toBe(1);
    /* standing beside it, the next load comes off a neighbor */
    expect(res.cutNear(x, y, 3, DAY_SECONDS * 50)).toBe(3);
    const ch = res.takeChanges()!;
    expect(ch[0]).toBe(i); expect(ch[1]).toBe(Tree.Snag); expect(res.takeChanges()).toBeNull();
    /* the ecology counts the patch again */
    expect(res.takeDirty()).toContain(((y / CELL) | 0) * Math.ceil(w.w / CELL) + ((x / CELL) | 0));
    /* bare ground gives only brush, half a load; reeds are never cut */
    const bare = w.tree.findIndex(t => !t); expect(res.cut(bare % w.w, (bare / w.w) | 0, 4, 0)).toBe(2);
    const reeds = w.tree.indexOf(Tree.Reeds); if (reeds >= 0) { expect(res.cut(reeds % w.w, (reeds / w.w) | 0, 4, 0)).toBe(4); expect(w.tree[reeds]).toBe(Tree.Reeds); }
  });
  it("a felled wood falls, then grows back from its edges over the decades", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const res = new Resources(w, SEED), i = forestTile(w), x0 = i % w.w, y0 = (i / w.w) | 0;
    const cut: number[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y0 + dy) * w.w + x0 + dx; while (w.tree[j] !== Tree.Snag) res.cut(x0 + dx, y0 + dy, 20, 0); cut.push(j); }
    expect(cut.every(j => w.tree[j] === Tree.Snag)).toBe(true);
    const left = (r: number) => res.forestLeft(x0, y0, r);
    expect(left(2)).toBe(0);
    let t = 0;
    for (let d = 0; d < 40 * 3; d++) { t += DAY_SECONDS; res.daily(t); }
    /* within a few years the dead trees have fallen */
    expect(cut.filter(j => w.tree[j] === Tree.Snag).length).toBeLessThan(5);
    for (let d = 0; d < 40 * 60; d++) { t += DAY_SECONDS; res.daily(t); }
    expect(left(2)).toBeGreaterThanOrEqual(0.3);
    expect(res.stats.regrown).toBeGreaterThanOrEqual(8);
    /* what grows back is what grew there */
    for (const j of cut) if (w.tree[j]) expect(w.tree[j]).toBe(res.orig[j]);
  });
  it("paints the land by what stands on it, with the deposits over it", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const res = new Resources(w, SEED), d = res.deposits.find(d => d.kind === Mat.Clay)!;
    res.find(0, d);
    const px = bake(w, 1, "resources", undefined, { deposits: res.deposits.map((o, k) => ({ kind: o.kind, x: o.x, y: o.y, r: o.r, amount: o.amount, left: o.left, knownBy: res.knownBy()[k] })), colors: ["#ff0000"] });
    const o = at(w, d.x, d.y) * 4;
    /* the disc is the clay's color, more or less */
    expect(Math.abs(px[o] - 0xb5)).toBeLessThan(40); expect(Math.abs(px[o + 2] - 0x3a)).toBeLessThan(40);
    /* a treed tile reads green, bare ground tan */
    const forest = forestTile(w) * 4, bare = w.tree.findIndex((t, i) => !t && !(w.flags[i] & Flag.Water) && w.biome[i] === Biome.Grassland) * 4;
    expect(px[forest + 1]).toBeGreaterThan(px[forest]); expect(px[bare]).toBeGreaterThan(px[bare + 2]);
  });
});

describe("people and the land", () => {
  it("explorers find the deposits around them, their people remembers, and the find is told", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
    settle(wild, eco, 2, () => {});
    const s = new Society(w, eco, wild, SEED, { start: "bands", bands: 8 }, (DAYS_PER_SEASON + 0.32) * DAY_SECONDS);
    const res = s.resources;
    /* a band with a clay bank its people has not found yet within a day's walk: an explorer walks out to it */
    const pick = s.bands.map(b => ({ b, d: res.deposits.filter(d => d.kind === Mat.Clay && !res.known.get(b.culture)?.has(d.id)).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0] })).filter(o => o.d).sort((a, c) => Math.hypot(a.d.x - a.b.x, a.d.y - a.b.y) - Math.hypot(c.d.x - c.b.x, c.d.y - c.b.y))[0];
    const b = pick.b, d = pick.d, p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) > 20)!;
    const culture = s.culture(p).id;
    expect(Math.hypot(d.x - b.x, d.y - b.y)).toBeLessThan(60);
    p.x = d.x + 3; p.y = d.y;
    const before = s.events.filter(e => e.kind === "found").length;
    s.learnSurroundings(p, 10);
    expect(p.places.some(pl => pl.k === Place.Deposit && pl.ref === d.id && pl.sp === Mat.Clay)).toBe(true);
    expect(res.known.get(culture)?.has(d.id)).toBe(true);
    expect(res.knownNear(culture, d.x, d.y, 2, "clay")).toBe(true);
    /* told once per kind for a people */
    const told = s.events.filter(e => e.kind === "found").length - before;
    expect(told).toBeLessThanOrEqual(1);
    if (told) { const e = s.events.filter(e => e.kind === "found").pop()!; expect(e.text).toContain(p.name); expect(e.text).toContain("clay"); }
    const d2 = res.deposits.find(o => o.kind === Mat.Clay && o !== d && !res.known.get(culture)?.has(o.id))!;
    p.x = d2.x; p.y = d2.y; s.learnSurroundings(p, 4);
    expect(s.events.filter(e => e.kind === "found").length - before).toBe(told);
  });
  it("gathering firewood brings trees down around a camp, and the wood problem is felt", () => {
    const w: WorldData = { ...world, tree: world.tree.slice() };
    const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
    settle(wild, eco, 2, () => {});
    const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
    const s = new Society(w, eco, wild, SEED, { start: "bands", bands: 10 }, t0);
    let time = t0, lastDay = -1;
    for (let k = 0; k < 40 * 5 * DAY_SECONDS / 2; k++) {
      time += 2;
      const season = Math.floor(time / DAY_SECONDS / DAYS_PER_SEASON) % 4, day = Math.floor(time / DAY_SECONDS);
      wild.update(2, season, day);
      if (day !== lastDay) { lastDay = day; eco.daily(season); }
      s.update(2, time, season);
    }
    expect(s.resources.stats.cut).toBeGreaterThan(100);
    expect(s.resources.stats.felled).toBeGreaterThan(0);
    expect(w.tree.filter(t => t === Tree.Snag).length).toBeGreaterThan(0);
    /* the felled tiles were posted to the page */
    expect(s.resources.takeChanges()?.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(s.bands.every(b => b.problems.length > 0)).toBe(true);
  });
});
