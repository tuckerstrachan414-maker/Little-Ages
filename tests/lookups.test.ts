import { describe, it, expect, beforeAll } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society, withinLo, withinHi } from "../src/sim/people/society.ts";
import { Work, addWork, worksAround } from "../src/sim/people/works.ts";
import { voice, feudSides } from "../src/sim/people/leaders.ts";
import { feudOf } from "../src/sim/people/feuds.ts";
import { Rng } from "../src/shared/rng.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  The lookups everybody makes every few seconds (who is near, which herds, which works,
  who is kin) take short cuts: squared distances, merged lists, scratch arrays. Each must
  give exactly what the plain way gives, or a world would run differently for the sake of
  speed. One world, run long enough to have an archive of the dead, villages of works and
  herds about, is asked both ways.
*/
const SEED = 7;
const world: WorldData = generateWorld("medium", SEED, () => {});
function fresh(years: number) {
  const w: WorldData = { ...world, tree: world.tree.slice() };
  const eco = new Ecology(w, SEED), wild = new Wildlife(w, SEED, eco);
  settle(wild, eco, 4, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  const s = new Society(w, eco, wild, SEED, { start: "bands", bands: 12 }, t0);
  let time = t0, lastDay = -1;
  const end = time + years * 40 * DAY_SECONDS;
  while (time < end) {
    time += 2;
    const season = Math.floor(time / DAY_SECONDS / DAYS_PER_SEASON) % 4, day = Math.floor(time / DAY_SECONDS);
    wild.update(2, season, day);
    if (day !== lastDay) { lastDay = day; eco.daily(season); }
    s.update(2, time, season);
  }
  return { s };
}
/** The plain test every short cut must agree with. */
const plain = (dx: number, dy: number, r: number) => Math.hypot(dx, dy) <= r;
const quick = (dx: number, dy: number, r: number) => { const d2 = dx * dx + dy * dy, lo = withinLo(r), hi = withinHi(r); return d2 <= lo || (d2 <= hi && Math.hypot(dx, dy) <= r); };
/** `kin` the long way: everyone's forebears to `depth` as sets, compared. */
function kinPlain(s: Society, a: { id: number }, b: { id: number }, depth: number): boolean {
  const up = (id: number, d: number, out: Set<number>) => { if (!id || d < 0) return; out.add(id); const r = s.byId.get(id) ?? s.archive.get(id); if (r) { up(r.mother, d - 1, out); up(r.father, d - 1, out); } };
  const A = new Set<number>(), B = new Set<number>();
  up(a.id, depth, A); up(b.id, depth, B);
  for (const x of A) if (B.has(x)) return true;
  return false;
}

describe("the quick lookups give what the plain ones give", () => {
  let s: Society;
  beforeAll(() => { s = fresh(8).s; }, 600000);

  it("decides 'within r' exactly as Math.hypot does, at the edge and beyond", () => {
    const rng = new Rng(11);
    let edge = 0;
    for (let k = 0; k < 200000; k++) {
      const r = [0, 0.1, 1, 2.5, 4, 6, 8.5, 13, 19, 30, 40, rng.next() * 50, -1, NaN, Infinity][k % 15];
      let dx: number, dy: number;
      if (k % 3 === 0) { /* right on the circle, or as near it as doubles allow */ const a = rng.next() * Math.PI * 2; dx = Math.cos(a) * r; dy = Math.sin(a) * r; }
      else if (k % 3 === 1) { dx = (rng.next() - 0.5) * 100; dy = (rng.next() - 0.5) * 100; }
      else { dx = Math.round(rng.next() * 40 - 20) / 4; dy = Math.round(rng.next() * 40 - 20) / 4; }
      if (k % 7 === 0) { dx = 3; dy = 4; }
      if (k % 7 === 1) dx = NaN;
      if (plain(dx, dy, r) && dx * dx + dy * dy > withinLo(r)) edge++;
      expect(quick(dx, dy, r)).toBe(plain(dx, dy, r));
    }
    expect(edge).toBeGreaterThan(1000);
  });

  it("finds the same people, herds, works and kin as searching everything", () => {
    expect(s.people.length).toBeGreaterThan(200);
    expect(s.archive.size).toBeGreaterThan(30);
    const rng = new Rng(SEED);
    /* villages' worth of works around every camp, made in id order like any others */
    for (let k = 0; k < 240; k++) {
      const b = s.bands[k % s.bands.length], x = b.x + (rng.next() - 0.5) * 24, y = b.y + (rng.next() - 0.5) * 24, h = b.members[0];
      addWork(s, { kind: [Work.Hut, Work.Pit, Work.Plot][k % 3], x, y, wx: x, wy: y, band: b.id, home: h, by: h, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 1, built: s.time, style: "round", look: "plain", size: 1 });
    }
    expect(s.works.length).toBeGreaterThanOrEqual(240);
    const ids = (a: { id: number }[]) => a.map(o => o.id);
    /*
      People and herds are looked up in grids laid out at the start of each tick (people walk a
      little before anyone asks), so the plain way walks the same grids, as `near` and
      `herdsNear` always did, with the exact test; works never move, so all of them are asked.
    */
    const grid = (s as any).grid as Map<number, { id: number; x: number; y: number }[]>, herdGrid = (s as any).herdGrid as Map<number, { id: number; n: number; x: number; y: number }[]>;
    const nearPlain = (x: number, y: number, r: number) => {
      const out: { id: number }[] = [], x0 = Math.floor((x - r) / 8), x1 = Math.floor((x + r) / 8), y0 = Math.floor((y - r) / 8), y1 = Math.floor((y + r) / 8);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const a = grid.get(gy * 4096 + gx); if (a) for (const p of a) if (plain(p.x - x, p.y - y, r)) out.push(p); }
      return out;
    };
    const herdsPlain = (x: number, y: number, r: number) => {
      const out: { id: number }[] = [], x0 = Math.floor((x - r) / 16), x1 = Math.floor((x + r) / 16), y0 = Math.floor((y - r) / 16), y1 = Math.floor((y + r) / 16);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const a = herdGrid.get(gy * 4096 + gx); if (a) for (const h of a) if (h.n > 0 && plain(h.x - x, h.y - y, r)) out.push(h); }
      return out;
    };
    expect(grid.size).toBeGreaterThan(10);
    let people = 0, herds = 0, works = 0;
    for (let k = 0; k < 300; k++) {
      const at = k % 2 ? s.people[Math.floor(rng.next() * s.people.length)] : s.bands[Math.floor(rng.next() * s.bands.length)];
      const x = at.x + (rng.next() - 0.5) * 6, y = at.y + (rng.next() - 0.5) * 6;
      const r = [2.5, 3.5, 4, 6, 7, 8.5, 9, 13, 14, 30][k % 10];
      const near = s.near(x, y, r), ref = nearPlain(x, y, r);
      expect(ids(near)).toEqual(ids(ref)); people += ref.length;
      const hn = s.herdsNear(x, y, r), hr = herdsPlain(x, y, r);
      expect(ids(hn)).toEqual(ids(hr)); herds += hr.length;
      const wa = worksAround(s, x, y, r), wr = s.works.filter(w => plain(w.x - x, w.y - y, r)).sort((a, b) => a.id - b.id);
      expect(wa.map(w => w.id)).toEqual(wr.map(w => w.id)); works += wr.length;
    }
    expect(people).toBeGreaterThan(500); expect(herds).toBeGreaterThan(50); expect(works).toBeGreaterThan(100);
    /* works out of their making order (which never happens, but is allowed for) are sorted as before */
    s.works.reverse(); s.worksVersion++;
    for (let k = 0; k < 40; k++) {
      const b = s.bands[k % s.bands.length], x = b.x + (rng.next() - 0.5) * 8, y = b.y + (rng.next() - 0.5) * 8, r = 8.5;
      expect(worksAround(s, x, y, r).map(w => w.id)).toEqual(s.works.filter(w => plain(w.x - x, w.y - y, r)).sort((a, b) => a.id - b.id).map(w => w.id));
    }
    s.works.reverse(); s.worksVersion++;
    /* kin, the living with the living and with the dead, at every depth asked about */
    const dead = [...s.archive.values()];
    let close = 0, asked = 0;
    for (const a of s.people) for (let k = 0; k < 24; k++) {
      const b = k < 16 ? s.people[Math.floor(rng.next() * s.people.length)] : dead[Math.floor(rng.next() * dead.length)];
      for (const depth of [0, 1, 2, 3]) { const got = s.kin(a, b, depth); expect(got).toBe(kinPlain(s, a, b, depth)); asked++; if (got && depth === 1) close++; }
    }
    expect(asked).toBeGreaterThan(10000); expect(close).toBeGreaterThan(50);
    /* someone not on record anywhere is only kin to themself */
    const ghost = { id: 1e9, mother: s.people[0].id, father: 0 };
    expect(s.kin(s.people[0], ghost, 2)).toBe(kinPlain(s, s.people[0], ghost, 2));
    expect(s.kin(s.people[0], ghost, 2)).toBe(false);
    expect(s.kin(s.people[0], { id: 0, mother: 0, father: 0 }, 1)).toBe(false);
  }, 600000);

  it("weighs a band's voices the same from the day's feud sides as feud by feud", () => {
    /* feuds of every shape: within a band, across bands, with the dead, and one cooled below notice */
    const dead = [...s.archive.keys()], rng = new Rng(5);
    let id = 1e6;
    for (let k = 0; k < 40; k++) {
      const p = s.people[Math.floor(rng.next() * s.people.length)];
      const q = k % 3 === 0 ? s.people.find(o => o.band === p.band && o !== p) : k % 3 === 1 ? s.people[Math.floor(rng.next() * s.people.length)] : { id: dead[Math.floor(rng.next() * dead.length)] };
      if (q && q.id !== p.id) s.feuds.push({ id: id++, a: p.id, b: q.id, heat: k % 5 === 4 ? 0.05 : 0.3 + rng.next() * 0.7, since: s.time, last: s.time, cause: "a test", band: p.band, fights: 0, lastFight: 0, inherited: false, mediated: 0 });
    }
    let pairs = 0, feuding = 0;
    for (const b of s.bands) {
      const adults = b.members.map(i => s.byId.get(i)!).filter(p => p && s.age(p) >= 16);
      const sides = feudSides(s, adults);
      for (const p of adults) for (const q of adults) {
        expect(voice(s, b, p, q, sides)).toBe(voice(s, b, p, q)); pairs++;
        if (p !== q && s.age(q) >= 18 && feudOf(s, p, q)) feuding++;
      }
    }
    expect(pairs).toBeGreaterThan(1000); expect(feuding).toBeGreaterThan(10);
  });
});
