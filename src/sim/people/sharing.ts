import { DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Food, Goal, Mem, type Person } from "./person.ts";
import { homeOf, storeFood, type Band, type Hearth } from "./band.ts";
import { FOOD_DAY, type Society } from "./society.ts";
import { grievance, feudOf, feudBetween } from "./feuds.ts";

/*
  Sharing. Food brought back to camp is split: some goes into the band's pot, where anyone
  may eat it, and the rest stays at the household's own hearth for the family. How much is
  shared is up to whoever brought it, within their people's custom: meat from a big kill
  is nearly always shared out (nobody can eat a whole aurochs, and a hunter who keeps it
  is remembered), plant food mostly feeds the family that gathered it. Generous people
  share more, greedy ones less, and a family going short keeps more back.

  Everyone eats from their own hearth first, then from the pot. When both are bare and the
  children are hungry, people go and ask a household that has food: kin first, then
  friends, then whoever owes them. Asked face to face, most people give. Those who give are
  thanked, owed, and paid back when the asker's family next brings food in; those who turn
  a hungry family away when they have plenty are not forgiven quickly, and the whole camp
  notices.
*/

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The kinds of food in the order they spoil: meat and fish first, plant food last. */
const SPOIL_ORDER = ["meat", "fish", "plant"] as const;

/** The members of a band who share a household's hearth. */
export function household(s: Society, b: Band, head: number): Person[] {
  const out: Person[] = [];
  for (const id of b.members) { const q = s.byId.get(id); if (q && homeOf(q, s.byId, s.time) === head) out.push(q); }
  return out;
}
/** What a household eats in a day. */
export function appetiteOf(s: Society, folk: Person[]): number { let a = 0; for (const q of folk) a += FOOD_DAY[s.stage(q)]; return Math.max(0.6, a); }
/** The same for a household by its head, worked out once per game second per band (households seldom change faster). */
const appCache = new WeakMap<Band, { t: number; m: Map<number, number> }>();
export function householdAppetite(s: Society, b: Band, head: number): number {
  const t = Math.floor(s.time);
  let c = appCache.get(b);
  if (!c || c.t !== t) { c = { t, m: new Map() }; appCache.set(b, c); }
  let v = c.m.get(head);
  if (v === undefined) { v = appetiteOf(s, household(s, b, head)); c.m.set(head, v); }
  return v;
}

export function hearthOf(s: Society, p: Person): Hearth {
  const b = s.band(p), h = homeOf(p, s.byId, s.time);
  let hh = b.hearths.get(h);
  if (!hh) { hh = { plant: 0, meat: 0, fish: 0 }; b.hearths.set(h, hh); }
  return hh;
}
/** Days of food at someone's own hearth, for their whole household. */
export function hearthDays(s: Society, p: Person): number {
  const b = s.band(p), head = homeOf(p, s.byId, s.time), h = b.hearths.get(head);
  return h ? storeFood(h) / householdAppetite(s, b, head) : 0;
}
/**
  How many days a household feels it has to eat: its own hearth with a fair share of the
  pot, weighed together with how full the pot is for everyone. A family with a full
  hearth still feels the pull when the pot is empty, because the others will come asking.
*/
export function familyDays(s: Society, p: Person): number {
  const b = s.band(p), head = homeOf(p, s.byId, s.time), h = b.hearths.get(head);
  const app = householdAppetite(s, b, head), band = Math.max(1, b.appetite);
  const pot = storeFood(b.store);
  return ((h ? storeFood(h) : 0) + pot * app / band) / app * 0.6 + pot / band * 0.4;
}
/** Food someone can simply reach for: their own hearth, the pot, and what close family can spare. */
export function reachFood(s: Society, p: Person): number {
  const b = s.band(p), mine = homeOf(p, s.byId, s.time), h = b.hearths.get(mine);
  const own = storeFood(b.store) + (h ? storeFood(h) : 0);
  return own > 0.4 ? own : own + familySpare(s, p, b, mine);
}
/** Close family whose hearth someone may eat from without asking: parents, partner, children, in the same band. */
function familyHearths(s: Society, p: Person, b: Band, mine: number): [Person, number, Hearth][] {
  const out: [Person, number, Hearth][] = [];
  for (const id of [p.mother, p.father, p.partner, ...p.children]) {
    const q = s.byId.get(id); if (!q || q.band !== b.id) continue;
    const head = homeOf(q, s.byId, s.time); if (head === mine || out.some(o => o[1] === head)) continue;
    const h = b.hearths.get(head); if (h && storeFood(h) >= 0.3) out.push([q, head, h]);
  }
  return out;
}
function familySpare(s: Society, p: Person, b: Band, mine: number): number {
  let v = 0;
  for (const [, head, h] of familyHearths(s, p, b, mine)) v += Math.max(0, storeFood(h) - householdAppetite(s, b, head) * 0.5);
  return v;
}

function take(from: { plant: number; meat: number; fish: number }, want: number): number {
  let left = want;
  for (const k of SPOIL_ORDER) { const t = Math.min(left, from[k]); from[k] -= t; left -= t; if (left <= 1e-9) break; }
  return want - left;
}
/** Moves `amt` of food between two stores, what spoils first going first; returns what moved. */
export function pass(from: { plant: number; meat: number; fish: number }, to: { plant: number; meat: number; fish: number }, amt: number): number {
  let left = amt;
  for (const k of SPOIL_ORDER) { const t = Math.min(left, from[k]); from[k] -= t; to[k] += t; left -= t; if (left <= 1e-9) break; }
  return amt - left;
}

/**
  Eats up to `want` days of food: from the household's hearth first, then the band's pot,
  and when both are bare, from the hearth of close family (parents, grown children,
  brothers and sisters), who do not need to be asked. Returns what was eaten.
*/
export function eat(s: Society, p: Person, b: Band, want: number): number {
  if (want <= 0) return 0;
  const mine = homeOf(p, s.byId, s.time), h = b.hearths.get(mine);
  let got = h ? take(h, want) : 0;
  const fromPot = take(b.store, want - got);
  got += fromPot;
  if (got < want - 1e-9 && (want >= 0.05 || p.food < 0.5)) got += fromFamily(s, p, b, mine, want - got);
  if (got <= 0) return 0;
  p.food = Math.min(2.5, p.food + got);
  /* only what came out of the pot counts as taking from the others */
  if (fromPot > 0) p.took = p.took * 0.98 + fromPot * 0.02 * 40;
  b.today.eaten += got; s.stats.social.eaten += got;
  return got;
}

/** What close family will let someone eat from their hearth: whatever they have beyond half a day for themselves. */
function fromFamily(s: Society, p: Person, b: Band, mine: number, want: number): number {
  let got = 0;
  for (const [q, head, h] of familyHearths(s, p, b, mine)) {
    const spare = storeFood(h) - householdAppetite(s, b, head) * 0.5; if (spare <= 0) continue;
    const t = take(h, Math.min(spare, want - got));
    if (t > 0) { got += t; const r = s.rel(p, q.id); r.owe += t * 0.3; s.rel(q, p.id).owe -= t * 0.3; b.today.given += t; s.stats.social.given += t; s.stats.social.family += t; }
    if (got >= want - 1e-9) break;
  }
  return got;
}

/**
  How much of what someone brings in they put into the pot, 0..1: their people's custom,
  what kind of food it is, how generous they are, and how their own family is fed.
*/
export function shareFraction(s: Society, p: Person, kind: number, amt: number): number {
  const c = s.culture(p), t = p.traits, b = s.band(p);
  let f = c.sharing + (kind === Food.Meat ? 0.2 : kind === Food.Fish ? -0.05 : -0.22);
  f += (0.5 - t[2]) * 0.4 + (t[1] - 0.5) * 0.2;
  /* a big haul is shared more: nobody can eat it all before it spoils, and meat and fish spoil within a day in the warm */
  if (amt >= 5) f += 0.08;
  if (kind !== Food.Plant) { const T = s.tempC(b.x, b.y); if (T > 5) f += Math.min(0.2, (T - 5) / 50); }
  /* the one the band listens to is watched, and keeps a following by giving */
  if (b.respected === p.id) f += 0.12;
  /* a family going short keeps more back; a pot already full needs less */
  const fam = hearthDays(s, p);
  if (fam < 1.5) f -= (1.5 - fam) * 0.15;
  if (storeFood(b.store) / Math.max(1, b.appetite) > 4) f -= 0.15;
  return Math.max(0.05, Math.min(1, f));
}

/**
  Food brought back to camp: shared into the pot, kept at the hearth, and part of what is
  kept paid back to a household that fed this family in a hard time.
*/
export function deposit(s: Society, p: Person, kind: number, amt: number): void {
  const b = s.band(p);
  const f = shareFraction(s, p, kind, amt), shared = amt * f, kept = amt - shared;
  const key = kind === Food.Plant ? "plant" : kind === Food.Fish ? "fish" : "meat";
  b.store[key] += shared;
  const h = hearthOf(s, p);
  h[key] += kept;
  b.today.shared += shared;
  p.shareRate = p.shareRate * 0.85 + f * 0.15;
  p.shared = p.shared * 0.98 + shared * 0.02 * 40;
  p.prestige += shared / (kind === Food.Meat ? 40 : 90) + kept / (kind === Food.Meat ? 140 : 240);
  if (kept > 0.5) repay(s, p, b, h, kept * 0.5);
}

/** Paying back: the biggest debt this household owes another hearth in the band gets part of what was kept. */
function repay(s: Society, p: Person, b: Band, h: Hearth, most: number): void {
  let to: Person | null = null, owed = 0.5;
  for (const [id, r] of p.rel) { if (r.owe > owed) { const q = s.byId.get(id); if (q && q.band === b.id && homeOf(q, s.byId, s.time) !== homeOf(p, s.byId, s.time)) { owed = r.owe; to = q; } } }
  if (!to) return;
  const paid = pass(h, hearthOf(s, to), Math.min(most, owed));
  if (paid <= 0) return;
  s.rel(p, to.id).owe -= paid; s.rel(to, p.id).owe += paid;
  const rt = s.rel(to, p.id); rt.op = Math.min(1, rt.op + 0.03 + paid * 0.01);
  p.shared = p.shared * 0.98 + paid * 0.02 * 40;
  b.today.given += paid;
  s.stats.social.repaid += paid;
  if (s.rel(p, to.id).owe < 0.5) s.remember(to, Mem.Repaid, p.id, 0.15);
}

/* ---------------- asking ---------------- */

export interface AskTarget { head: number; by: Person; v: number; }

/**
  Whose hearth to ask at: one with food to spare and someone home, where the asker expects
  a welcome. Close kin come first, then those who owe them, then friends, and nobody they
  are feuding with or who turned them away lately.
*/
export function askTarget(s: Society, p: Person): AskTarget | null {
  const b = s.band(p), mine = homeOf(p, s.byId, s.time);
  let best: AskTarget | null = null;
  for (const [head, h] of b.hearths) {
    if (head === mine || storeFood(h) < 0.6) continue;
    const folk = household(s, b, head); if (!folk.length) continue;
    const spare = storeFood(h) - appetiteOf(s, folk) * 0.8; if (spare < 0.4) continue;
    /* someone of that household has to be at camp to ask */
    let by: Person | null = null;
    for (const q of folk) if (s.age(q) >= 15 && !q.carrier && Math.hypot(q.x - b.x, q.y - b.y) < 7 && q.goal !== Goal.Sleep && (!by || q.id === head)) by = q;
    if (!by) continue;
    if (feudOf(s, p, by)) continue;
    const refused = p.mem.some(m => m.k === Mem.Refused && m.who === by!.id && s.time - m.t < DAY_SECONDS * 1.5);
    if (refused) continue;
    const r = p.rel.get(by.id);
    const kin = by.id === p.partner || s.kin(p, by, 1) ? 1 : s.kin(p, by, 2) ? 0.5 : 0;
    const v = kin * 0.8 + (r ? r.op * 0.6 + (r.owe < -0.3 ? 0.4 : 0) : 0) + Math.min(1, spare / 4) * 0.3 + (b.respected === by.id ? 0.15 : 0) - Math.hypot(by.x - p.x, by.y - p.y) * 0.01;
    if (!best || v > best.v) best = { head, by, v };
  }
  return best && best.v > -0.2 ? best : null;
}

/** How likely `g` is to give to `a`, who has come asking: custom, temperament, kinship, what they owe each other, and how much there is. */
export function willShare(s: Society, g: Person, a: Person, spareDays: number): number {
  const c = s.culture(g), t = g.traits;
  let v = c.sharing * 0.6 + (0.5 - t[2]) * 0.5 + (t[1] - 0.5) * 0.4;
  v += a.id === g.partner || s.kin(g, a, 1) ? 0.4 : s.kin(g, a, 2) ? 0.2 : 0;
  v += s.op(g, a.id) * 0.5;
  const r = g.rel.get(a.id);
  if (r && r.owe > 0.3) v += 0.35;
  if (r && r.owe < -3) v -= 0.15;
  if (feudOf(s, g, a)) v -= 0.9;
  if (hungryKids(s, a)) v += 0.1 + t[1] * 0.15;
  /* hardly anyone turns away someone who is starving */
  if (a.food < 0.25 || a.health < 0.6) v += 0.3 + t[1] * 0.2;
  if (g.mem.some(m => m.k === Mem.Freeloader && m.who === a.id)) v -= 0.25;
  /* the one the band listens to knows everyone is watching */
  if (s.band(g).respected === g.id) v += 0.15;
  return clamp01(v * Math.max(0.3, Math.min(1.3, spareDays / 1.5)));
}
export function hungryKids(s: Society, p: Person): boolean {
  for (const id of p.children) { const c = s.byId.get(id); if (c && c.band === p.band && s.age(c) < 12 && s.age(c) >= 1 && c.food < 0.6) return true; }
  return false;
}

/** The answer at the hearth: food handed over, or a hungry family turned away. Returns what was given. */
export function answer(s: Society, g: Person, a: Person, head: number): number {
  const b = s.band(g), h = b.hearths.get(head);
  const folk = household(s, b, head), mineFolk = household(s, b, homeOf(a, s.byId, s.time));
  const spare = h ? storeFood(h) - appetiteOf(s, folk) * 0.8 : 0;
  s.stats.social.asks++;
  if (spare < 0.3) { a.why = `${a.name} asked ${g.name} for food, but ${g.name}'s family had none to spare.`; a.whyAt = s.time; return 0; }
  const spareDays = spare / appetiteOf(s, folk);
  const kids = hungryKids(s, a);
  if (s.rng.chance(willShare(s, g, a, spareDays))) {
    const want = appetiteOf(s, mineFolk) * 1.2;
    const amt = pass(h!, hearthOf(s, a), Math.min(spare, want));
    const ra = s.rel(a, g.id);
    ra.op = Math.min(1, ra.op + 0.08 + Math.min(0.08, amt * 0.01)); ra.owe += amt;
    s.rel(g, a.id).owe -= amt;
    s.remember(a, Mem.Fed, g.id, 0.3);
    g.shared = g.shared * 0.98 + amt * 0.02 * 40; g.prestige += amt / 120;
    b.today.given += amt; s.stats.social.given += amt;
    s.bubble(g, Bubble.Meat, 2); s.bubble(a, Bubble.Heart, 2);
    a.why = `${a.name} asked ${g.name} for food${kids ? ` for ${a.sex === "f" ? "her" : "his"} hungry children` : ""}, and ${g.name} gave ${a.sex === "f" ? "her" : "him"} some.`; a.whyAt = s.time;
    return amt;
  }
  /* turned away while their hearth was full */
  s.stats.social.refused++;
  const severity = (kids ? 0.5 : 0.3) * (spareDays > 3 ? 1.3 : 1);
  const ra = s.rel(a, g.id); ra.op = Math.max(-1, ra.op - 0.1 - severity * 0.15);
  s.remember(a, Mem.Refused, g.id, -0.35 - severity * 0.2);
  a.askedAt = s.time + DAY_SECONDS * 0.15;
  s.bubble(a, Bubble.Angry, 2.5);
  a.why = `${a.name} asked ${g.name} for food, and ${g.name} turned ${a.sex === "f" ? "her" : "him"} away.`; a.whyAt = s.time;
  /* the camp sees who turns a hungry family away */
  for (const q of s.near(g.x, g.y, 6)) {
    if (q === g || q === a || q.band !== g.band || s.age(q) < 12) continue;
    const r = s.rel(q, g.id); r.op = Math.max(-1, r.op - 0.03 * (kids ? 1.5 : 1));
    if (kids && s.rng.chance(0.3)) s.remember(q, Mem.Stingy, g.id, -0.15);
  }
  grievance(s, a, g, severity, kids ? `turned ${a.sex === "f" ? "her" : "him"} away while ${a.sex === "f" ? "her" : "his"} children went hungry` : `refused ${a.sex === "f" ? "her" : "him"} food`);
  if (kids && spareDays > 1.5) s.event("refused", Bubble.Angry, `${g.name} of the ${b.name} would not share food with ${a.name}, though ${a.name}'s children were hungry and ${g.name}'s hearth had plenty.`, g.x, g.y, [a.id, g.id], b.id, 1);
  return 0;
}

/* ---------------- the evening round ---------------- */

/**
  Every evening, food passes between hearths without anyone asking: a household with more
  than another sends some over, more to close kin, friends and those it owes, less to the
  rest, as far as its generosity goes. It evens things out, the way sharing does in a band:
  when food runs short everyone goes a little hungry rather than a few starving. Feuding
  families send each other nothing, and the stingy keep most of theirs, which is noticed.
*/
export function shareRound(s: Society, b: Band): void {
  type HH = { head: number; folk: Person[]; app: number; h: Hearth; days: number; by: Person; generous: number };
  const hs: HH[] = [];
  const seen = new Set<number>();
  for (const id of b.members) {
    const q = s.byId.get(id); if (!q) continue;
    const head = homeOf(q, s.byId, s.time); if (seen.has(head)) continue;
    seen.add(head);
    const folk = household(s, b, head), adults = folk.filter(o => s.age(o) >= 15);
    const by = adults.find(o => o.id === head) ?? adults[0] ?? folk[0];
    const h = b.hearths.get(head) ?? hearthOf(s, q), app = appetiteOf(s, folk);
    const c = s.culture(by), t = by.traits;
    const generous = clamp01(c.sharing * 0.6 + (0.5 - t[2]) * 0.5 + (t[1] - 0.5) * 0.4 + (b.respected === by.id ? 0.15 : 0));
    hs.push({ head, folk, app, h, days: storeFood(h) / app, by, generous });
  }
  if (hs.length < 2) return;
  const potDays = storeFood(b.store) / Math.max(1, b.appetite);
  /* the hungriest first, each drawing on the households they are closest to */
  const needy = hs.filter(x => x.days + potDays < 1.5).sort((x, y) => x.days - y.days);
  for (const n of needy) {
    /* only the two households at the heart of a feud send each other nothing; their kin still share */
    const givers = hs.filter(g => g !== n && g.days > Math.max(0.6, n.days + 0.5) && !g.folk.some(x => n.folk.some(y => feudBetween(s, x, y)))).map(g => {
      const kin = n.folk.some(q => q.id === g.by.partner || s.kin(g.by, q, 1)) ? 1 : n.folk.some(q => s.kin(g.by, q, 2)) ? 0.6 : 0;
      const r = g.by.rel.get(n.by.id);
      return { g, tie: kin + Math.max(0, r?.op ?? 0) * 0.6 + (r && r.owe > 0.3 ? 0.3 : 0) };
    }).sort((x, y) => y.tie - x.tie);
    for (const { g, tie } of givers) {
      const gap = g.days - n.days;
      if (gap <= 0.4 || n.days + potDays >= 1.5) break;
      /* half the difference between them, shared out as their generosity and the tie between them go */
      const amt = pass(g.h, n.h, gap / 2 * Math.min(g.app, n.app) * g.generous * Math.min(1, 0.35 + tie * 0.65));
      if (amt <= 0.05) continue;
      g.days = storeFood(g.h) / g.app; n.days = storeFood(n.h) / n.app;
      const r = s.rel(n.by, g.by.id); r.op = Math.min(1, r.op + 0.01 + Math.min(0.04, amt * 0.008)); r.owe += amt * 0.3;
      s.rel(g.by, n.by.id).owe -= amt * 0.3;
      g.by.shared = g.by.shared * 0.98 + amt * 0.02 * 40; g.by.prestige += amt / 250;
      b.today.given += amt; s.stats.social.given += amt; s.stats.social.rounds += amt;
    }
  }
}

/* ---------------- keeping the hearths straight ---------------- */

/**
  Households change: a couple forms or parts, a child grows up, someone dies or leaves. Food
  at a hearth whose household no longer exists goes to whoever carries that household on
  (the widower, the children), or into the pot if nobody does.
*/
export function reconcileHearths(s: Society, b: Band): void {
  if (!b.hearths.size) return;
  const heads = new Set<number>();
  for (const id of b.members) { const q = s.byId.get(id); if (q) heads.add(homeOf(q, s.byId, s.time)); }
  for (const [k, h] of [...b.hearths]) {
    if (heads.has(k)) continue;
    b.hearths.delete(k);
    if (storeFood(h) <= 0) continue;
    let to: number | null = null;
    const q = s.byId.get(k);
    if (q && q.band === b.id) to = homeOf(q, s.byId, s.time);
    else {
      const a = s.archive.get(k) ?? q;
      const heirs = a ? [a.partner, ...a.children].map(id => s.byId.get(id)).filter((o): o is Person => !!o && o.band === b.id) : [];
      if (heirs.length) to = homeOf(heirs[0], s.byId, s.time);
    }
    if (to !== null && to !== k && heads.has(to)) { let t = b.hearths.get(to); if (!t) { t = { plant: 0, meat: 0, fish: 0 }; b.hearths.set(to, t); } pass(h, t, storeFood(h)); }
    else pass(h, b.store, storeFood(h));
  }
}
/** A household head moving to another band takes the hearth's food along. */
export function carryHearth(from: Band, to: Band, id: number): void {
  const h = from.hearths.get(id); if (!h) return;
  from.hearths.delete(id);
  let t = to.hearths.get(id); if (!t) { t = { plant: 0, meat: 0, fish: 0 }; to.hearths.set(id, t); }
  pass(h, t, storeFood(h));
}
/** Food spoils at the hearths as it does in the pot. */
export function spoilHearths(b: Band, meat: number, plant: number): void {
  for (const h of b.hearths.values()) { h.meat *= 1 - meat; h.fish *= 1 - meat; h.plant *= plant; }
}
/** Old debts are slowly forgotten; small ones sooner. */
export function forgetDebts(p: Person): void {
  for (const r of p.rel.values()) if (r.owe) { r.owe *= 0.985; if (Math.abs(r.owe) < 0.05) r.owe = 0; }
}
