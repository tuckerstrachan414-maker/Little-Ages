import { describe, it, expect } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { personDetail, bandDetail } from "../src/sim/people/inspect.ts";
import { Food, Goal, Mem, St, type Person } from "../src/sim/people/person.ts";
import { homeOf, storeFood, campFood } from "../src/sim/people/band.ts";
import { appetiteOf, deposit, eat, hearthOf, household, shareFraction, shareRound, willShare, answer, reconcileHearths } from "../src/sim/people/sharing.ts";
import { feudDay, feudOf, feudsOnDeath, grievance, handDown, maybeFight, sideOf, talkRound } from "../src/sim/people/feuds.ts";
import { chooseLeaders, followersOf, mock } from "../src/sim/people/leaders.ts";
import { gift } from "../src/sim/people/friends.ts";
import { doStep } from "../src/sim/people/doing.ts";
import { Bond, bondEdges } from "../src/sim/people/search.ts";
import { KINDS } from "../src/sim/people/chronicle.ts";
import { CATEGORIES, KIND_COLOR } from "../src/ui/history.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type WorldData } from "../src/shared/types.ts";

/*
  Sharing, feuds, leaders and friends. Most of these set up a moment by hand (a hungry family,
  a deep wrong, a band choosing whom to listen to) and check that people respond as they
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
const adultsOf = (s: Society, bandId: number) => s.bandById.get(bandId)!.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 18 && s.age(q) < 55);
/** Two adults of one band from different households, not close kin. */
function strangers(s: Society): [Person, Person] {
  for (const b of s.bands) {
    const ad = adultsOf(s, b.id);
    for (const a of ad) for (const c of ad) if (a !== c && homeOf(a, s.byId, s.time) !== homeOf(c, s.byId, s.time) && !s.kin(a, c, 2) && a.partner !== c.id) return [a, c];
  }
  throw new Error("no strangers");
}

describe("sharing: the pot and the hearths", () => {
  const { s } = fresh();
  it("splits what someone brings in between the band's pot and their own hearth, meat shared more than plant food", () => {
    const [a] = strangers(s);
    const b = s.band(a);
    const pot0 = storeFood(b.store), h0 = storeFood(hearthOf(s, a));
    deposit(s, a, Food.Plant, 6);
    const potGain = storeFood(b.store) - pot0, hearthGain = storeFood(hearthOf(s, a)) - h0;
    expect(potGain + hearthGain).toBeGreaterThan(5.4);
    expect(potGain).toBeGreaterThan(0);
    expect(shareFraction(s, a, Food.Meat, 6)).toBeGreaterThan(shareFraction(s, a, Food.Plant, 6));
  });
  it("the greedy keep more back than the generous, and a leader shares more", () => {
    const [a] = strangers(s);
    const keep = a.traits.slice();
    a.traits[2] = 0.95; a.traits[1] = 0.1; const greedy = shareFraction(s, a, Food.Plant, 3);
    a.traits[2] = 0.05; a.traits[1] = 0.9; const generous = shareFraction(s, a, Food.Plant, 3);
    expect(generous).toBeGreaterThan(greedy + 0.3);
    a.traits[2] = 0.5; a.traits[1] = 0.5; const plain = shareFraction(s, a, Food.Plant, 3);
    const b = s.band(a), had = b.respected;
    b.respected = a.id; const leading = shareFraction(s, a, Food.Plant, 3); b.respected = had;
    expect(leading).toBeGreaterThan(plain);
    a.traits = keep;
  });
  it("people eat from their own hearth before the pot", () => {
    const [a] = strangers(s);
    const b = s.band(a), h = hearthOf(s, a);
    h.plant = 3; h.meat = 0; h.fish = 0; const pot0 = storeFood(b.store);
    a.food = 0.2;
    expect(eat(s, a, b, 1)).toBeCloseTo(1, 5);
    expect(storeFood(h)).toBeCloseTo(2, 5);
    expect(storeFood(b.store)).toBeCloseTo(pot0, 5);
    h.plant = 0.4; eat(s, a, b, 1);
    expect(storeFood(h)).toBe(0);
    expect(storeFood(b.store)).toBeCloseTo(pot0 - 0.6, 5);
  });
  it("asked face to face, kin give more readily than strangers, and nearly everyone gives to the starving", () => {
    /* someone with a grown relative in the band, and someone of the band who is no kin of theirs */
    let a: Person | undefined, kinOfA: Person | undefined, c: Person | undefined;
    for (const q of s.people) {
      if (s.age(q) < 18) continue;
      const k = s.people.find(o => o !== q && o.band === q.band && s.kin(q, o, 1) && s.age(o) >= 16);
      const st = s.people.find(o => o !== q && o.band === q.band && !s.kin(q, o, 2) && o.id !== q.partner && s.age(o) >= 16);
      if (k && st) { a = q; kinOfA = k; c = st; break; }
    }
    expect(a && kinOfA && c).toBeTruthy();
    const keep = [c!.traits.slice(), kinOfA!.traits.slice()], ra = s.rel(c!, a!.id).op, rk = s.rel(kinOfA!, a!.id).op, food = a!.food;
    /* the same temperament and the same liking for the asker: only kinship differs */
    for (const g of [c!, kinOfA!]) { g.traits[1] = 0.5; g.traits[2] = 0.5; s.rel(g, a!.id).op = 0.2; }
    a!.food = 0.8;
    const stranger = willShare(s, c!, a!, 1.5), kin = willShare(s, kinOfA!, a!, 1.5);
    expect(kin).toBeGreaterThan(stranger);
    a!.food = 0.1;
    expect(willShare(s, c!, a!, 1.5)).toBeGreaterThan(stranger + 0.2);
    a!.food = food; s.rel(c!, a!.id).op = ra; s.rel(kinOfA!, a!.id).op = rk; c!.traits = keep[0]; kinOfA!.traits = keep[1];
  });
  it("food handed over leaves gratitude and a debt; a hungry family turned away from a full hearth remembers, and the camp notices", () => {
    const [a, c] = strangers(s);
    const hc = hearthOf(s, c);
    hc.plant = appetiteOf(s, household(s, s.band(c), homeOf(c, s.byId, s.time))) * 6;
    /* a generous, kind giver: gives */
    c.traits[2] = 0.05; c.traits[1] = 0.95; s.rel(c, a.id).op = 0.6;
    let got = 0;
    for (let k = 0; k < 20 && got <= 0; k++) got = answer(s, c, a, homeOf(c, s.byId, s.time));
    expect(got).toBeGreaterThan(0);
    expect(s.rel(a, c.id).owe).toBeGreaterThan(0);
    expect(a.mem.some(m => m.k === Mem.Fed && m.who === c.id)).toBe(true);
    /* a greedy, cold one who dislikes the asker: turns them away */
    c.traits[2] = 1; c.traits[1] = 0; s.rel(c, a.id).op = -1;
    const before = s.op(a, c.id), refused0 = s.stats.social.refused;
    for (let k = 0; k < 20 && s.stats.social.refused === refused0; k++) answer(s, c, a, homeOf(c, s.byId, s.time));
    expect(s.stats.social.refused).toBeGreaterThan(refused0);
    expect(s.op(a, c.id)).toBeLessThan(before);
    expect(a.mem.some(m => m.k === Mem.Refused && m.who === c.id)).toBe(true);
  });
  it("the evening round evens out the hearths, close kin first", () => {
    const b = s.bands.find(x => x.hearths.size >= 4)!;
    reconcileHearths(s, b);
    const heads = [...b.hearths.keys()];
    for (const h of heads) { const hh = b.hearths.get(h)!; hh.plant = 0; hh.meat = 0; hh.fish = 0; }
    b.store.plant = 0; b.store.meat = 0; b.store.fish = 0;
    const rich = heads[0], richH = b.hearths.get(rich)!;
    richH.plant = 40;
    shareRound(s, b);
    expect(storeFood(richH)).toBeLessThan(40);
    const fed = [...b.hearths].filter(([h, hh]) => h !== rich && storeFood(hh) > 0).length;
    expect(fed).toBeGreaterThan(0);
    /* nothing is lost or made up: what left the rich hearth arrived at the others */
    const total = [...b.hearths.values()].reduce((a, hh) => a + storeFood(hh), 0);
    expect(total).toBeCloseTo(40, 4);
  });
  it("a household's food goes with it when the head dies or moves away", () => {
    const b = s.bands[0];
    const h = [...b.hearths.keys()].find(k => household(s, b, k).length >= 2 && s.byId.get(k));
    expect(h).toBeTruthy();
    const total = campFood(b);
    b.hearths.get(h!)!.plant += 10;
    s.die(s.byId.get(h!)!, "illness");
    if (s.bandById.has(b.id)) expect(campFood(b)).toBeCloseTo(total + 10, 3);
  });
});

describe("feuds", () => {
  const { s } = fresh();
  it("a deep wrong to someone of hot temper becomes a feud, and the two families take sides", () => {
    const [a, c] = strangers(s);
    a.traits[6] = 1; a.traits[1] = 0;
    s.rel(a, c.id).op = -0.8;
    const n0 = s.feuds.length;
    grievance(s, a, c, 1, "refused her food");
    expect(s.feuds.length).toBe(n0 + 1);
    const f = feudOf(s, a, c)!;
    expect(f).toBeTruthy();
    expect(s.events.some(e => e.kind === "feud" && e.who.includes(a.id) && e.who.includes(c.id))).toBe(true);
    /* a's close kin are on a's side */
    const kin = s.people.find(q => q !== a && q.band === a.band && s.kin(a, q, 1) && !s.kin(c, q, 1) && q.id !== c.partner && s.age(q) >= 10);
    if (kin) {
      expect(sideOf(s, f, kin)).toBe(1);
      const op0 = s.op(kin, c.id);
      f.heat = 1; f.last = s.time;
      for (let d = 0; d < 6; d++) feudDay(s);
      expect(s.op(kin, c.id)).toBeLessThan(op0);
    }
  });
  it("feuding people will not hunt together, and keep the grudge while it is hot", () => {
    const f = s.feuds[0], a = s.byId.get(f.a)!, c = s.byId.get(f.b)!;
    f.heat = 0.8; f.last = s.time;
    feudDay(s);
    expect(s.op(a, c.id)).toBeLessThanOrEqual(-0.3);
    expect(willShare(s, c, a, 2)).toBeLessThan(0.3);
  });
  it("tempers boil over into a fight when they come face to face", () => {
    const f = s.feuds[0], a = s.byId.get(f.a)!, c = s.byId.get(f.b)!;
    f.heat = 1; f.lastFight = -1e9; a.traits[6] = 1;
    a.goal = Goal.Rest; c.goal = Goal.Rest; a.injury = 0; c.injury = 0;
    c.x = a.x + 1; c.y = a.y;
    (s as unknown as { rebuildGrid(): void }).rebuildGrid();
    const fights = s.stats.social.fights;
    for (let k = 0; k < 400 && (a.goal as number) !== Goal.Fight; k++) maybeFight(s, a);
    expect(a.goal).toBe(Goal.Fight);
    /* with c, or someone of c's family standing by */
    const foe = s.byId.get(a.plan[0].id)!;
    expect(sideOf(s, f, foe)).toBe(2);
    expect(foe.goal).toBe(Goal.Fight);
    for (let k = 0; k < 60 && (a.plan[a.si]?.k === St.Fight || foe.plan[foe.si]?.k === St.Fight); k++) { doStep(s, a, 0.1); doStep(s, foe, 0.1); }
    expect(s.stats.social.fights).toBe(fights + 1);
    expect(s.events.some(e => e.kind === "fight" && e.who.includes(a.id))).toBe(true);
  });
  it("a go-between both sides respect can talk a feud out", () => {
    const f = s.feuds[0], a = s.byId.get(f.a)!, c = s.byId.get(f.b)!;
    f.heat = 0.6;
    const go = s.people.find(q => q.band === a.band && q !== a && q !== c && !sideOf(s, f, q) && s.age(q) > 25)!;
    s.rel(a, go.id).op = 0.8; s.rel(c, go.id).op = 0.8; go.prestige = 2;
    const peace = s.stats.social.peace;
    for (let k = 0; k < 12 && s.stats.social.peace === peace; k++) { talkRound(s, go, a, c.id); talkRound(s, go, c, a.id); }
    expect(s.stats.social.peace).toBe(peace + 1);
    expect(feudOf(s, a, c)).toBeNull();
    expect(s.events.some(e => e.kind === "peace" && e.who.includes(go.id))).toBe(true);
  });
  it("a hot feud can outlive one side, passing to a grown child", () => {
    const [a, c] = strangers(s);
    a.traits[6] = 1; a.traits[1] = 0; s.rel(a, c.id).op = -0.9;
    grievance(s, a, c, 1, "took his wife from him");
    const f = feudOf(s, a, c)!;
    const kid = s.people.find(q => (q.mother === c.id || q.father === c.id) && s.age(q) >= 15 && !s.kin(q, a, 1));
    if (!kid) return;
    f.heat = 0.9;
    kid.traits[6] = 1;
    for (let k = 0; k < 30 && f.b === c.id; k++) { f.heat = 0.9; f.b = c.id; feudsOnDeath(s, c, "illness"); }
    /* it passed to one of those c leaves behind, who now holds it against a */
    expect(f.b).not.toBe(c.id);
    const heir = s.byId.get(f.b)!;
    expect(heir.mother === c.id || heir.father === c.id || heir.id === c.partner).toBe(true);
    expect(f.inherited).toBe(true);
    expect(s.op(heir, a.id)).toBeLessThan(-0.4);
  });
  it("children growing up take on their parents' strongest dislikes", () => {
    const child = s.people.find(q => s.age(q) >= 9 && s.age(q) < 15 && s.byId.get(q.mother))!;
    const mom = s.byId.get(child.mother)!;
    const target = s.people.find(q => q !== child && q !== mom && !s.kin(child, q, 1) && q.id !== mom.partner)!;
    s.rel(mom, target.id).op = -0.9;
    const before = s.op(child, target.id);
    for (let k = 0; k < 8; k++) handDown(s, child);
    expect(s.op(child, target.id)).toBeLessThan(Math.min(before, -0.4));
  });
});

describe("leaders", () => {
  const { s } = fresh();
  it("everyone settles on whose word they go along with; the band's leader has the biggest following", () => {
    for (const b of s.bands) chooseLeaders(s, b, adultsOf(s, b.id).concat(b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 55)));
    let led = 0;
    for (const b of s.bands) {
      if (!b.respected) continue;
      led++;
      const lead = s.byId.get(b.respected)!;
      expect(lead.band).toBe(b.id);
      const n = followersOf(s, lead);
      expect(n).toBe(b.followers);
      expect(n).toBeGreaterThanOrEqual(2);
      /* nobody else in the band has more */
      for (const id of b.members) { const q = s.byId.get(id)!; expect(followersOf(s, q)).toBeLessThanOrEqual(n); }
    }
    expect(led).toBeGreaterThan(s.bands.length / 2);
  });
  it("a leader is only replaced by someone with a clearly bigger following", () => {
    const b = s.bands.find(x => x.respected && adultsOf(s, x.id).length >= 8)!;
    const ad = b.members.map(id => s.byId.get(id)!).filter(q => s.age(q) >= 16);
    for (let d = 0; d < 3; d++) chooseLeaders(s, b, ad);
    const lead = s.byId.get(b.respected)!;
    expect(lead).toBeTruthy();
    /* nothing has changed, so neither does the leader */
    chooseLeaders(s, b, ad);
    expect(b.respected).toBe(lead.id);
    /* a great hunter everyone likes rises */
    const rival = ad.find(q => q !== lead && s.age(q) > 25 && !s.kin(q, lead, 1))!;
    rival.prestige = 30;
    for (const q of ad) if (q !== rival) s.rel(q, rival.id).op = 0.95;
    /* the leader has led long enough to be challenged */
    b.ledSince = s.time - DAY_SECONDS * 20;
    for (let d = 0; d < 3; d++) chooseLeaders(s, b, ad);
    expect(s.events.some(e => e.kind === "leader" && e.who.includes(rival.id))).toBe(true);
  });
  it("where people share freely, a proud hunter's big kill is made light of", () => {
    const b = s.bands[0];
    const keep = s.cultures[b.culture].sharing;
    s.cultures[b.culture].sharing = 0.85;
    const ad = adultsOf(s, b.id);
    const hunter = ad[0];
    hunter.traits[3] = 0.95; hunter.traits[1] = 0.1; hunter.prestige = 3; hunter.mem = [];
    for (const q of ad) { q.x = b.x + 1; q.y = b.y; }
    hunter.x = b.x; hunter.y = b.y;
    (s as unknown as { rebuildGrid(): void }).rebuildGrid();
    let mocked = false;
    for (let k = 0; k < 40 && !mocked; k++) {
      mock(s, hunter, { id: 9000 + k, x: b.x, y: b.y, sp: 1, meat: 100, hides: 1, t: s.time, by: hunter.id });
      mocked = s.events.some(e => e.kind === "mocked" && e.who.includes(hunter.id));
    }
    expect(mocked).toBe(true);
    expect(hunter.prestige).toBeLessThan(3);
    /* where people keep more for themselves, nobody bothers */
    s.cultures[b.culture].sharing = 0.56; hunter.mem = [];
    const n = s.stats.social.mocked;
    for (let k = 0; k < 40; k++) mock(s, hunter, { id: 9500 + k, x: b.x, y: b.y, sp: 1, meat: 100, hides: 1, t: s.time, by: hunter.id });
    expect(s.stats.social.mocked).toBe(n);
    s.cultures[b.culture].sharing = keep;
  });
});

describe("love lost, and friends far away", () => {
  const { s } = fresh();
  it("someone who leaves a marriage for another leaves a grudge against the newcomer", () => {
    const wife = s.people.find(q => q.sex === "f" && q.partner && s.age(q) > 20 && s.age(q) < 40 && s.byId.get(q.partner))!;
    const husband = s.byId.get(wife.partner)!;
    const other = s.people.find(q => q.sex === "m" && !q.partner && s.age(q) > 18 && s.age(q) < 45 && !s.kin(q, wife, 2) && !s.kin(q, husband, 1))!;
    husband.traits[6] = 1; husband.traits[1] = 0;
    s.pair(wife, other);
    expect(wife.partner).toBe(other.id);
    expect(husband.partner).toBe(0);
    expect(husband.mem.some(m => m.k === Mem.Left && m.who === wife.id)).toBe(true);
    expect(s.op(husband, other.id)).toBeLessThan(-0.4);
    expect(s.events.some(e => e.kind === "leftfor" && e.who.includes(wife.id))).toBe(true);
  });
  it("a gift warms both sides, and the first between two bands is told", () => {
    const a = s.people.find(q => s.age(q) > 20)!;
    const c = s.people.find(q => q.band !== a.band && s.age(q) > 20)!;
    const opA = s.op(c, a.id);
    const before = s.events.filter(e => e.kind === "gift").length;
    gift(s, a, c);
    expect(s.op(c, a.id)).toBeGreaterThan(opA);
    expect(c.mem.some(m => m.k === Mem.Gift && m.who === a.id)).toBe(true);
    expect(s.events.filter(e => e.kind === "gift").length).toBe(before + 1);
    gift(s, a, c);
    expect(s.events.filter(e => e.kind === "gift").length).toBe(before + 1);
  });
});

describe("a few years of sharing, quarrels and leading", () => {
  const { s, run } = fresh(10);
  /* for everyone who starves: how much food was at their own family's hearth */
  const starved: number[] = [];
  const die = s.die.bind(s);
  s.die = (p, cause) => { if (cause === "hunger" && s.byId.has(p.id)) { const h = s.band(p).hearths.get(homeOf(p, s.byId, s.time)); starved.push(h ? storeFood(h) : 0); } die(p, cause); };
  run(4);
  it("most food is shared into the pot, food passes between hearths, and households keep some back", () => {
    const o = s.stats.social;
    const frac = o.shared / (o.shared + o.kept);
    expect(frac).toBeGreaterThan(0.4);
    expect(frac).toBeLessThan(0.95);
    expect(o.given).toBeGreaterThan(100);
    expect(o.asks).toBeGreaterThan(0);
  });
  it("most bands have a leader whom several listen to, and leadership changes hands", () => {
    const big = s.bands.filter(b => adultsOf(s, b.id).length >= 6);
    expect(big.filter(b => b.respected).length).toBeGreaterThanOrEqual(big.length * 0.6);
    for (const b of big) if (b.respected) expect(s.byId.get(b.respected)!.band).toBe(b.id);
    expect(s.stats.social.leaders).toBeGreaterThan(0);
  });
  it("nobody starves beside their own family's well-stocked hearth", () => {
    for (const f of starved) expect(f).toBeLessThan(1);
  });
  it("the inspector tells of hearths, followings and feuds", () => {
    const b = s.bands.find(x => x.respected)!;
    const d = bandDetail(s, b.id)!;
    expect(d.followers).toBe(b.followers);
    expect(d.hearths.length).toBeGreaterThan(0);
    const lead = personDetail(s, b.respected)!;
    expect(lead.respected).toBe(true);
    expect(lead.followers).toBe(b.followers);
    expect(lead.leads).toBeGreaterThanOrEqual(0);
    for (const f of s.feuds) {
      const p = personDetail(s, f.a);
      if (p) expect(p.feuds.some(x => x.id === f.b)).toBe(true);
    }
  });
  it("draws the gold threads of whom people listen to", () => {
    const e = bondEdges(s, { x0: 0, y0: 0, x1: s.w.w, y1: s.w.h }, 20000);
    let follow = 0;
    for (let i = 0; i < e.length; i += 3) if (e[i + 2] === Bond.Follow) { follow++; expect(s.byId.get(e[i])!.follows).toBe(e[i + 1]); }
    expect(follow).toBeGreaterThan(0);
  });
  it("still lives the same life from the same seed", () => {
    const a = fresh(4), b = fresh(4);
    a.run(0.5); b.run(0.5);
    const sig = (x: Society) => x.people.map(p => `${p.id}:${p.x.toFixed(3)},${p.y.toFixed(3)}:${p.goal}:${p.follows}`).join("|") + `|${x.stats.social.given.toFixed(4)}|${x.feuds.length}`;
    expect(sig(a.s)).toBe(sig(b.s));
  });
});

describe("telling of it", () => {
  it("every kind of event has a journal group and a ribbon color", () => {
    const listed = new Set(CATEGORIES.flatMap(c => [...c.kinds] as string[]));
    for (const k of KINDS) { expect(listed.has(k)).toBe(true); expect(KIND_COLOR[k]).toBeTruthy(); }
  });
});
