import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { personDetail, bandDetail } from "../src/sim/people/inspect.ts";
import { Goal, St, step, type Person } from "../src/sim/people/person.ts";
import { noFood } from "../src/sim/people/band.ts";
import { spoil } from "../src/sim/people/sharing.ts";
import { IDEAS, Idea, countBand, discover, growUp, ideaSummary, ideasDay, inspire, learn, ready, shown, watch } from "../src/sim/people/ideas.ts";
import { Work, buildWeir, plotSite, sow, weirSite, worksDay } from "../src/sim/people/works.ts";
import { decide } from "../src/sim/people/mind.ts";
import { doStep } from "../src/sim/people/doing.ts";
import { searchWorld } from "../src/sim/people/search.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  Discoveries. Knowledge lives in heads: most of these set up a moment by hand (a dead fire
  and a curious person trying to bring it back, a parent who knows something their child
  does not, the last person who knows a thing dying) and check that it goes the way it
  should; the last part lives a few years and checks that it all happens on its own.
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
const adults = (s: Society) => s.people.filter(q => s.age(q) >= 18 && s.age(q) < 50);
/** A curious grown-up, and their band. */
function curious(s: Society): Person { return adults(s).sort((a, b) => b.traits[4] - a.traits[4])[0]; }

describe("knowledge lives in heads", () => {
  const { s } = fresh();
  it("everyone grown starts with the old ways of their people and nothing new", () => {
    for (const p of adults(s)) for (const d of IDEAS) expect(p.know[d.id] > 0).toBe(d.start);
    for (const d of IDEAS) if (!d.start) { expect(s.ideas[d.id].first).toBeNull(); expect(s.ideas[d.id].knowers).toBe(0); }
    for (const b of s.bands) expect(b.can[Idea.KeepFire]).toBeGreaterThan(5);
  });
  it("an idea cannot come to someone without what it builds on", () => {
    const p = curious(s);
    expect(ready(p, Idea.Axe)).toBe(false);
    expect(ready(p, Idea.Nets)).toBe(true);
    p.know[Idea.Fishing] = 0;
    expect(ready(p, Idea.Nets)).toBe(false);
    p.know[Idea.Fishing] = 0.5;
  });
  it("a curious person trying to bring back a dead fire may work out how to make it; with the fire burning it hardly ever comes", () => {
    const p = curious(s), b = s.band(p);
    const tries = (out: boolean, k: number) => {
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        b.fire = out ? 0 : 0.8;
        if (inspire(s, p, k)) { n++; p.know[Idea.MakeFire] = 0; p.from[Idea.MakeFire] = 0; s.ideas[Idea.MakeFire].knowers = 0; b.can[Idea.MakeFire] = 0; }
      }
      return n;
    };
    const pressed = tries(true, St.Kindle), idle = tries(false, St.Knap);
    expect(pressed).toBeGreaterThan(idle * 4);
    expect(pressed).toBeGreaterThan(3);
    b.fire = 0.8;
  });
  it("the first anyone works out is told as a first in the world, the next as new to a people or worked out again", () => {
    const p = curious(s), before = s.events.length;
    discover(s, p, Idea.Baskets, St.Gather, { full: true });
    expect(p.know[Idea.Baskets]).toBeGreaterThan(0);
    expect(p.from[Idea.Baskets]).toBe(-1);
    const e = s.events[before];
    expect(e.kind).toBe("discover");
    expect(e.title).toBe(IDEAS[Idea.Baskets].title);
    expect(s.ideas[Idea.Baskets].first?.who).toBe(p.id);
    const other = adults(s).find(q => s.band(q).culture !== s.band(p).culture)!;
    discover(s, other, Idea.Baskets, St.Gather, { full: true });
    expect(s.events[s.events.length - 1].title).toMatch(/New to a people/);
    expect(s.ideas[Idea.Baskets].times).toBe(2);
  });
});

describe("passing it on", () => {
  const { s } = fresh();
  it("children pick up what their parents know, growing up", () => {
    const kid = s.people.find(q => s.age(q) >= 9 && s.age(q) < 14 && s.byId.get(q.mother)?.band === q.band)!;
    const mom = s.byId.get(kid.mother)!;
    learn(s, mom, Idea.Digging, null, "seen");
    countBand(s, s.band(mom));
    for (let d = 0; d < 300 && !kid.know[Idea.Digging]; d++) growUp(s, kid, s.age(kid));
    expect(kid.know[Idea.Digging]).toBeGreaterThan(0);
    expect(kid.from[Idea.Digging]).toBe(mom.id);
  });
  it("someone shown how, a few times over, gets the knack of it", () => {
    const [a, b] = adults(s).filter(q => q.band === adults(s)[0].band);
    learn(s, a, Idea.Drying, null, "seen");
    a.know[Idea.Drying] = 0.8;
    for (let k = 0; k < 40 && !b.know[Idea.Drying]; k++) shown(s, a, b, Idea.Drying);
    expect(b.know[Idea.Drying]).toBeGreaterThan(0);
    expect(b.from[Idea.Drying]).toBe(a.id);
    expect(b.know[Idea.Drying]).toBeLessThan(a.know[Idea.Drying]);
  });
  it("standing by someone at work, the trick of it can sink in", () => {
    const p = adults(s).find(q => !q.know[Idea.Nets])!, q = adults(s).find(o => o !== p && o.band === p.band)!;
    learn(s, q, Idea.Nets, null, "seen");
    q.x = p.x + 1; q.y = p.y; q.plan = [step(St.Fish, q.x, q.y, 0, 10)]; q.si = 0; q.plan[0].t = 1;
    s.update(0.01, s.time + 0.01, s.season);
    q.x = p.x + 1; q.y = p.y; q.plan = [step(St.Fish, q.x, q.y, 0, 10)]; q.si = 0; q.plan[0].t = 1;
    for (let k = 0; k < 3000 && !p.know[Idea.Nets]; k++) watch(s, p);
    expect(p.know[Idea.Nets]).toBeGreaterThan(0);
  });
  it("what is known goes with whoever moves to another band, and the band is told who brought it", () => {
    const p = adults(s).find(q => q.know[Idea.Nets])!;
    const to = s.bands.find(b => b.id !== p.band && !b.can[Idea.Nets])!;
    ideasDay(s);
    s.moveTo(p, to);
    const before = s.events.length;
    ideasDay(s);
    const e = s.events.slice(before).find(x => x.kind === "spread" && x.band === to.id);
    expect(e?.text).toMatch(new RegExp(`${p.name}, who came to live with the ${to.name}`));
    expect(to.can[Idea.Nets]).toBeGreaterThan(0);
  });
  it("when the last who knew it dies, it is lost, to the band and to the world", () => {
    const p = adults(s).find(q => !q.know[Idea.Planting])!;
    learn(s, p, Idea.Digging, null, "seen");
    learn(s, p, Idea.Planting, null, "seen");
    ideasDay(s);
    expect(s.ideas[Idea.Planting].knowers).toBe(1);
    const before = s.events.length;
    s.die(p, "illness");
    ideasDay(s);
    const lost = s.events.slice(before).find(e => e.kind === "lost");
    expect(lost?.title).toMatch(/Lost to the world: planting/);
    expect(s.ideas[Idea.Planting].knowers).toBe(0);
    expect(s.ideas[Idea.Planting].lostAt).toBeGreaterThan(0);
  });
});

describe("fire", () => {
  const { s } = fresh();
  it("a dead fire stays dead in a band where nobody can make fire", () => {
    const b = s.bands[0];
    b.fire = 0; b.store.wood = 10;
    for (let k = 0; k < 200; k++) (s as unknown as { camps(dt: number): void }).camps(0.5);
    expect(b.fire).toBe(0);
  });
  it("someone who can make fire lights it again", () => {
    const b = s.bands[0], p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) >= 18 && s.age(q) < 50)!;
    learn(s, p, Idea.MakeFire, null, "seen"); countBand(s, b);
    b.fire = 0; b.store.wood = 10;
    p.x = b.x + 1; p.y = b.y; p.food = 1.5; p.water = 1; p.rest = 1; p.warmth = 1; p.sick = 0; p.injury = 0;
    decide(s, p);
    const kindling = p.goal === Goal.Kindle;
    p.plan = [step(St.Kindle, p.x, p.y, 0, 4)]; p.si = 0; p.goal = Goal.Kindle;
    for (let k = 0; k < 20; k++) doStep(s, p, 0.5);
    expect(kindling).toBe(true);
    expect(b.fire).toBeGreaterThan(0);
  });
  it("an ember carried home from another band's fire lights it, and is told", () => {
    const b = s.bands[1], p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) >= 18 && s.age(q) < 50)!;
    b.fire = 0; p.ember = s.time;
    const before = s.events.length;
    p.plan = [step(St.Kindle, b.x, b.y, 0, 2, { a: 1 })]; p.si = 0; p.goal = Goal.Kindle;
    for (let k = 0; k < 10; k++) doStep(s, p, 0.5);
    expect(b.fire).toBeGreaterThan(0);
    expect(s.events.slice(before).some(e => e.kind === "ember")).toBe(true);
  });
});

describe("things that stay where they are made", () => {
  const { s } = fresh();
  it("a weir in the river traps fish day after day, and wears", () => {
    const b = s.bands.find(x => weirSite(s, x))!, at = weirSite(s, b)!;
    const p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) >= 18)!;
    buildWeir(s, p, at, null);
    const w = s.works.find(k => k.kind === Work.Weir)!;
    for (let d = 0; d < 5; d++) worksDay(s);
    expect(w.food).toBeGreaterThan(0.5);
    expect(w.state).toBeLessThan(1);
  });
  it("a plot sown in spring ripens with food to harvest", () => {
    const b = s.bands.find(x => plotSite(s, x))!, at = plotSite(s, b)!;
    const p = b.members.map(id => s.byId.get(id)!).find(q => s.age(q) >= 18)!;
    learn(s, p, Idea.Digging, null, "seen"); learn(s, p, Idea.Planting, null, "seen");
    sow(s, p, at);
    const w = s.works.find(k => k.kind === Work.Plot)!;
    for (let d = 0; d < 45 && w.state < 1; d++) worksDay(s);
    expect(w.state).toBe(1);
    expect(w.food).toBeGreaterThan(10);
  });
  it("dried meat keeps while fresh meat rots", () => {
    const f = { ...noFood(), meat: 10, dried: 10 };
    for (let d = 0; d < 10; d++) spoil(f, 0.35, 0.97, 0.99);
    expect(f.meat).toBeLessThan(0.2);
    expect(f.dried).toBeGreaterThan(8.5);
  });
});

describe("a few years of discovery", () => {
  const { s, run } = fresh(12);
  run(4);
  it("people work things out on their own, and what they work out spreads", () => {
    expect(s.stats.ideas.found).toBeGreaterThan(2);
    const known = IDEAS.filter(d => !d.start && s.ideas[d.id].knowers > 0);
    expect(known.length).toBeGreaterThan(0);
    /* more people know each than worked it out */
    expect(known.some(d => s.ideas[d.id].knowers > s.ideas[d.id].times * 2)).toBe(true);
    expect(s.events.some(e => e.kind === "discover")).toBe(true);
  });
  it("whoever first worked each idea out is known as the one who did, for as long as they live", () => {
    let checked = 0;
    for (const d of IDEAS) {
      const f = s.ideas[d.id].first; if (!f) continue;
      const p = s.byId.get(f.who); if (!p) continue;
      expect(p.know[d.id]).toBeGreaterThan(0);
      expect(p.from[d.id]).toBe(-1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
  it("the tag says how someone came to know a thing; the band card says who knows what", () => {
    const p = s.people.find(q => IDEAS.some(d => !d.start && q.know[d.id] > 0))!;
    const d = personDetail(s, p.id)!;
    const k = d.knows.find(x => !x.start)!;
    expect(k.name.length).toBeGreaterThan(3);
    expect(k.how === "" || /worked it out|from /.test(k.how)).toBe(true);
    const b = bandDetail(s, p.band)!;
    expect(b.ideas.some(i => !i.start && i.n > 0)).toBe(true);
  });
  it("the world's record of ideas, and search, know them by name", () => {
    const sum = ideaSummary(s);
    expect(sum.length).toBe(IDEAS.length);
    const found = sum.find(x => x.first)!;
    expect(found.first!.name.length).toBeGreaterThan(1);
    const hits = searchWorld(s, found.name.split(" ")[0]);
    expect(hits.some(h => h.kind === "idea")).toBe(true);
  });
});
