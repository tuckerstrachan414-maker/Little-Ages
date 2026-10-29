import { Biome, Flag } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Goal, Mem, St, type Person } from "./person.ts";
import type { Band } from "./band.ts";
import { feudOf } from "./feuds.ts";
import type { Society } from "./society.ts";
import { TECHS, TECH_COUNT, Idea, DURING, packHint, techIx, type Ctx } from "../tech/tree.ts";
import { HOOKS } from "../tech/hooks.ts";
import { genericPressure, fillStory } from "../tech/engine.ts";
import { practiced, passRefine } from "../tech/refine.ts";

/*
  What people know how to do. Knowledge lives only in heads. Nobody is handed an
  invention: a curious person, in the middle of related work and pressed by a real need
  (the fire dead on a cold night, more food in the patch than two arms can carry, meat
  going bad in the heat), may see a better way. Once someone knows a thing it spreads the
  way it did for foragers: children pick it up growing up, people watch each other at
  work, someone takes the time to show a friend or a nephew, and people who marry into
  another band or go to live there bring what they know. It is lost the same way: when the
  last person in a band who knew it dies or leaves, the band no longer knows it, and when
  the last person anywhere is gone, it has to be worked out all over again.

  The nodes themselves, every one from keeping fire to spaceflight, are data in tech/tree.ts.
*/

export { Idea, type TechDef as IdeaDef, type Ctx } from "../tech/tree.ts";
export const IDEAS = TECHS, IDEA_COUNT = TECH_COUNT;

/** The world's record of each idea: who first worked it out, how often it has been found, how many know it now. */
export interface IdeaLog {
  first: { who: number; name: string; band: number; bandName: string; people: string; t: number; x: number; y: number } | null;
  /** times it has been worked out by someone who did not learn it */
  times: number;
  /** the peoples that have ever known it */
  cultures: Set<number>;
  knowers: number; bands: number;
  /** the one who knew it best at the last count, to name if it is lost */
  keeper: number;
  /** when the last who knew it died (0 while someone does) */
  lostAt: number;
}
export const newIdeaLog = (s: Society): IdeaLog[] => TECHS.map(d => ({ first: null, times: 0, cultures: d.start ? new Set(s.cultures.map((_, i) => i)) : new Set(), knowers: 0, bands: 0, keeper: 0, lostAt: 0 }));

const She = (p: Person) => (p.sex === "f" ? "She" : "He");
const her = (p: Person) => (p.sex === "f" ? "her" : "his");
const herObj = (p: Person) => (p.sex === "f" ? "her" : "him");

export const knows = (p: Person, id: number) => p.know[id] > 0;
/** The ways of keeping animals, for whoever watches a herder at work. */
const HERDING = () => ["taming-dogs", "herding-goats-and-sheep", "herding-cattle", "herding-pigs", "milking", "penning"].map(k => techIx(k));
/** Keeps someone's list of known ideas in step with `know`, in rising order. */
export function noteKnown(p: Person, id?: number): void {
  if (id === undefined) { p.knownIds = []; for (let i = 0; i < TECH_COUNT; i++) if (p.know[i] > 0) p.knownIds.push(i); return; }
  if (p.know[id] <= 0 || p.knownIds.includes(id)) return;
  let k = 0; while (k < p.knownIds.length && p.knownIds[k] < id) k++;
  p.knownIds.splice(k, 0, id);
}
/** Whether someone knows all an idea builds on (and at least one of what it may build on instead). */
export function ready(p: Person, id: number): boolean {
  const d = TECHS[id];
  for (const n of d.needs) if (p.know[n] <= 0) return false;
  if (d.any.length) { let ok = false; for (const n of d.any) if (p.know[n] > 0) { ok = true; break; } if (!ok) return false; }
  return true;
}
/** Practice makes better: how well someone knows a thing creeps up each time they do it, and their people's way of doing it is refined a little (see tech/refine.ts). */
export function practice(s: Society, p: Person, id: number, amt = 0.01): void { if (p.know[id] > 0) { p.know[id] = Math.min(1, p.know[id] + amt); practiced(s, p, id, amt); } }
/** Whether anyone in a band knows it (counted each morning, and whenever someone learns). */
export const bandKnows = (b: Band, id: number) => b.can[id] > 0;

/** What a founder knows for their age: the old ways of their people, better the longer they have lived by them. */
export function founderKnow(age: number, adult: number): Float32Array {
  const k = new Float32Array(TECH_COUNT);
  for (const d of TECHS) {
    if (!d.start) continue;
    const at = d.id === Idea.KeepFire || d.id === Idea.Snares ? 8 : 12;
    if (age >= at) k[d.id] = Math.min(1, 0.25 + adult * 0.5 + Math.max(0, age - 30) * 0.008);
  }
  return k;
}

/* ---------------- working something out ---------------- */

/** How good a person is at seeing a new way: curiosity most, then skill in that line of work, and the years of their life. */
function aptitude(p: Person, id: number, age: number): number {
  const cur = p.traits[4];
  return (0.2 + 2.2 * cur * cur) * (0.55 + p.skills[TECHS[id].skill] * 0.9) * (0.85 + p.traits[7] * 0.3) * (age < 16 ? 0.6 : age < 50 ? 1 : 0.7);
}

/** How badly the person (and their band) needs a better way right now, 0..1. Without need, ideas seldom come. */
export function pressure(s: Society, p: Person, id: number, k: number, c: Ctx): number {
  const h = HOOKS[id]?.pressure;
  return h ? h(s, p, k, c) : genericPressure(s, p, TECHS[id], c);
}

/** A piece of work done: someone in the middle of it may see a better way. */
/** How far from camp a known deposit counts as at hand: a few hours' walk there and back with a load. */
export const NEAR_REACH = 20;
export function inspire(s: Society, p: Person, k: number, c: Ctx = {}): boolean {
  const list = DURING[k]; if (!list) return false;
  const age = s.age(p); if (age < 12) return false;
  for (const id of list) {
    if (p.know[id] > 0 || !ready(p, id)) continue;
    /* some come only in a particular moment: keeping cattle to someone with a calf in hand, milking to someone whose animals have young */
    const flags = TECHS[id].ctx;
    if (flags && !flags.some(f => c[f])) continue;
    /* some things cannot come to mind without the stuff of them within reach: no pots where no clay is known */
    const near = TECHS[id].near;
    if (near) { const b = s.band(p); if (!near.every(m => s.resources.knownNear(b.culture, b.x, b.y, NEAR_REACH, m))) continue; }
    const pr = pressure(s, p, id, k, c); if (pr <= 0) continue;
    const odds = pr * aptitude(p, id, age);
    s.stats.inspire.tries[id]++; s.stats.inspire.odds[id] += odds;
    if (s.rng.chance(TECHS[id].spark * odds)) { discover(s, p, id, k, c); return true; }
  }
  return false;
}

/** How a discovery happened, in words. */
function story(s: Society, p: Person, id: number, k: number, c: Ctx): string {
  const h = HOOKS[id]?.story, d = TECHS[id];
  return h ? h(s, p, k, c) : d.story ? fillStory(s, p, d, c, d.story) : `${p.name} of the ${s.band(p).name} worked out ${d.how}.`;
}

export function discover(s: Society, p: Person, id: number, k: number, c: Ctx = {}): void {
  const d = TECHS[id], b = s.band(p), log = s.ideas[id], cult = s.cultures[b.culture];
  const level = !log.times && !log.knowers ? 2 : !log.cultures.has(b.culture) ? 1 : 0;
  p.know[id] = 0.35; p.from[id] = -1; noteKnown(p, id);
  if (!b.can[id]) b.keeper[id] = p.id;
  b.can[id]++;
  log.times++; log.cultures.add(b.culture); log.knowers++; log.lostAt = 0;
  if (!log.keeper || !s.byId.has(log.keeper)) log.keeper = p.id;
  if (!log.first) log.first = { who: p.id, name: p.name, band: b.id, bandName: b.name, people: cult.lang.name, t: s.time, x: p.x, y: p.y };
  s.remember(p, Mem.Discovered, 0, 0.6, id);
  p.prestige += 0.25 + level * 0.15;
  s.bubble(p, Bubble.Star, 4);
  s.stats.ideas.found++;
  const tail = level === 2 ? " Nobody anywhere has done it before." : level === 1 ? ` It is new to the ${cult.lang.name}.` : "";
  s.event("discover", d.icon, story(s, p, id, k, c) + tail, p.x, p.y, [p.id], b.id, packHint(level, id));
}

/* ---------------- passing it on ---------------- */

/** Learning something from someone (or, with no teacher, from what one has seen). */
export function learn(s: Society, p: Person, id: number, teacher: Person | null, how: "child" | "watch" | "shown" | "told" | "seen"): void {
  if (p.know[id] > 0) return;
  const tm = teacher ? teacher.know[id] : 0.25;
  p.know[id] = Math.max(0.12, Math.min(0.6, 0.1 + tm * 0.4)); noteKnown(p, id);
  p.from[id] = teacher?.id ?? (how === "seen" ? -2 : 0);
  const b = s.band(p), log = s.ideas[id];
  const fresh = !b.can[id];
  if (fresh) b.keeper[id] = p.id;
  b.can[id]++; log.knowers++; log.cultures.add(b.culture);
  if (!log.keeper || !s.byId.has(log.keeper)) log.keeper = p.id;
  s.stats.learned++; s.stats.ideas[how]++;
  if (teacher) {
    s.remember(p, Mem.Learned, teacher.id, 0.3, id);
    const r = s.rel(p, teacher.id); r.op = Math.min(1, r.op + 0.05);
    /* a thing learned from another people comes with most of their way of doing it */
    const tc = s.bandById.get(teacher.band)?.culture; if (tc !== undefined && tc !== b.culture) passRefine(s, tc, b.culture, id);
  }
  /* the first of a band to know a thing, learned from someone of another band */
  if (fresh && !TECHS[id].start && teacher && teacher.band !== p.band) {
    const tb = s.band(teacher);
    s.event("spread", TECHS[id].icon, `${p.name} of the ${b.name} learned ${TECHS[id].how} from ${teacher.name} of the ${tb.name}${how === "watch" ? `, watching ${herObj(teacher)} at it` : ""}. ${She(p)} is the first of the ${b.name} to know it.`, p.x, p.y, [p.id, teacher.id], b.id, packHint(tb.culture !== b.culture ? 1 : 0, id));
  } else if (fresh && !TECHS[id].start && !teacher && how === "seen") {
    s.event("spread", TECHS[id].icon, `${p.name} of the ${b.name} worked out ${TECHS[id].how} from one left standing by others. ${She(p)} is the first of the ${b.name} to know it.`, p.x, p.y, [p.id], b.id, packHint(0, id));
  }
}

/** Growing up: children pick up what the grown-ups around them know, from their parents first and then anyone in the band. What nobody in the band knows, nobody can learn. */
export function growUp(s: Society, p: Person, age: number): void {
  const b = s.band(p);
  for (const d of TECHS) {
    if (p.know[d.id] > 0 || age < d.age || !ready(p, d.id) || !b.can[d.id]) continue;
    const parent = [s.byId.get(p.mother), s.byId.get(p.father), s.byId.get(p.guardian)].find(q => q && q.band === p.band && q.know[d.id] > 0);
    let teacher = parent;
    if (!teacher) for (const id of b.members) { const q = s.byId.get(id); if (q && q !== p && q.know[d.id] > 0 && s.age(q) >= 16) { teacher = q; break; } }
    if (!teacher || !s.rng.chance(d.child * (0.5 + p.traits[4]) * (parent ? 1.4 : 0.8))) continue;
    learn(s, p, d.id, teacher, "child");
  }
}

/** The ideas someone is putting to use right now, for whoever is watching. */
export function inUse(q: Person): number[] {
  const st = q.plan[q.si]; if (!st || st.t <= 0) return [];
  const has = (id: number) => q.know[id] > 0;
  switch (st.k) {
    case St.Fish: return st.id ? [Idea.Weirs, Idea.Fishing] : has(Idea.Nets) ? [Idea.Nets, Idea.Fishing] : [Idea.Fishing];
    case St.Gather: { const o: number[] = []; if (st.id) o.push(Idea.Planting); if (has(Idea.Baskets)) o.push(Idea.Baskets); if (has(Idea.Digging)) o.push(Idea.Digging); return o; }
    case St.Sow: return [Idea.Planting];
    case St.Snare: return [Idea.Snares];
    case St.Knap: return has(Idea.Blades) ? [Idea.Blades, Idea.Spear] : [Idea.Spear];
    case St.Stalk: return [Idea.Spear];
    case St.Butcher: return has(Idea.Blades) ? [Idea.Blades] : [];
    case St.Wood: return has(Idea.Axe) ? [Idea.Axe] : [];
    case St.Craft: return [Idea.Hides];
    case St.Kindle: return has(Idea.MakeFire) ? [Idea.MakeFire] : [];
    case St.Dry: return [Idea.Drying];
    case St.Build: return [Idea.Weirs];
    case St.Raise: return [Idea.Huts];
    case St.Pit: case St.Store: return [Idea.Pits];
    case St.Cook: return [Idea.KeepFire];
    case St.Herd: return HERDING().filter(has);
  }
  return [];
}

/** Watching others at work, close by: now and then the trick of it sinks in. */
export function watch(s: Society, p: Person): void {
  const age = s.age(p); if (age < 5 || p.goal === Goal.Sleep) return;
  for (const q of s.near(p.x, p.y, 3.5)) {
    if (q === p || q.carrier) continue;
    for (const id of inUse(q)) {
      const d = TECHS[id];
      if (p.know[id] > 0 || age < d.age || !ready(p, id)) continue;
      if (s.rng.chance(d.watch * (0.35 + p.traits[4]) * (q.band === p.band ? 1 : 0.7))) { learn(s, p, id, q, "watch"); return; }
    }
  }
}

/** Someone to show something useful to: a band member close by, at ease, who does not know it, kin and friends first. */
export function showTarget(s: Society, p: Person): { q: Person; id: number; v: number } | null {
  const b = s.band(p);
  let best: { q: Person; id: number; v: number } | null = null;
  for (const q of s.near(p.x, p.y, 14)) {
    if (q === p || q.band !== p.band || q.carrier) continue;
    if (!(q.goal === Goal.Rest || q.goal === Goal.None || q.goal === Goal.Warm || q.goal === Goal.Play || q.goal === Goal.Follow)) continue;
    const age = s.age(q); if (age < 8) continue;
    if (feudOf(s, p, q)) continue;
    const kin = q.id === p.partner || s.kin(p, q, 1);
    for (const id of p.knownIds) {
      const d = TECHS[id];
      if (p.know[d.id] < 0.25 || q.know[d.id] > 0 || age < d.age || !ready(q, d.id)) continue;
      /* the fewer who know it, the more it matters to pass on */
      const v = d.worth * (0.6 + 0.4 / Math.max(1, b.can[d.id])) * (kin ? 1.2 : 0.7 + s.op(p, q.id) * 0.4) * (age < 14 ? 0.6 : 1);
      if (!best || v > best.v) best = { q, id: d.id, v };
    }
  }
  return best;
}

/** At the end of a lesson: whether it took. */
export function shown(s: Society, a: Person, b: Person, id: number): void {
  const d = TECHS[id]; if (!d || b.know[id] > 0 || !ready(b, id)) return;
  practice(s, a, id, 0.01);
  a.prestige += 0.01;
  const r = s.rel(b, a.id); r.op = Math.min(1, r.op + 0.04);
  if (s.rng.chance(d.show * (0.45 + b.traits[4] * 0.7) * (0.6 + a.know[id] * 0.6))) {
    learn(s, b, id, a, "shown");
    s.remember(a, Mem.Taught, b.id, 0.15, id);
    s.bubble(b, Bubble.Star, 2.5);
    b.why = `${b.name} has learned ${d.how} from ${a.name}.`; b.whyAt = s.time;
  } else { b.why = `${b.name} is trying to learn ${d.how} from ${a.name}, but has not got the knack of it yet.`; b.whyAt = s.time; }
}

/** Between friends of two bands, a visit can pass on a way of doing things. */
export function tellIdea(s: Society, a: Person, b: Person): void {
  if (!s.rng.chance(0.15)) return;
  for (const [from, to] of [[a, b], [b, a]] as [Person, Person][]) {
    const age = s.age(to);
    const id = from.knownIds.map(i => TECHS[i]).find(d => from.know[d.id] >= 0.25 && to.know[d.id] <= 0 && age >= d.age && ready(to, d.id) && !d.start)?.id;
    if (id !== undefined && s.rng.chance(TECHS[id].show * (0.4 + to.traits[4] * 0.6))) { learn(s, to, id, from, "told"); return; }
  }
}

/* ---------------- what each band knows, and what it loses ---------------- */

/** Counts who knows what in a band, and the one who knows each best. */
export function countBand(s: Society, b: Band): void {
  const can = new Int32Array(TECH_COUNT), keeper = new Int32Array(TECH_COUNT), best = new Float32Array(TECH_COUNT);
  for (const id of b.members) {
    const q = s.byId.get(id); if (!q) continue;
    for (let i = 0; i < TECH_COUNT; i++) if (q.know[i] > 0) { can[i]++; if (q.know[i] > best[i]) { best[i] = q.know[i]; keeper[i] = q.id; } }
  }
  b.can = can; b.keeper = keeper;
}

/**
  Each morning: who knows what, band by band. A band that knew something yesterday and
  has nobody who knows it today has lost it; one that knows something new, without anyone
  having learned or worked it out there, has had it brought in by someone who came to live
  with them. A thing nobody alive knows is lost to the world.
*/
export function ideasDay(s: Society): void {
  const world = new Int32Array(TECH_COUNT), bandsWith = new Int32Array(TECH_COUNT), keeper = new Int32Array(TECH_COUNT), best = new Float32Array(TECH_COUNT);
  const before = new Map<Band, { can: Int32Array; keeper: Int32Array }>();
  for (const b of s.bands) {
    before.set(b, { can: b.can, keeper: b.keeper });
    countBand(s, b);
    for (let i = 0; i < TECH_COUNT; i++) {
      world[i] += b.can[i]; if (b.can[i]) bandsWith[i]++;
      const q = s.byId.get(b.keeper[i]); if (q && q.know[i] > best[i]) { best[i] = q.know[i]; keeper[i] = q.id; }
    }
  }
  for (let i = 0; i < TECH_COUNT; i++) {
    const log = s.ideas[i];
    if (log.knowers > 0 && world[i] === 0) {
      log.lostAt = s.time;
      const a = s.archive.get(log.keeper), ab = a ? s.bandById.get(a.band) : undefined;
      const text = a ? `${a.name}${ab ? ` of the ${ab.name}` : ""} has died, the last who knew ${TECHS[i].how}.` : "";
      s.event("lost", Bubble.Sad, `${text ? text + " " : ""}Nobody anywhere knows ${TECHS[i].how} any more.`, a?.x ?? 0, a?.y ?? 0, a ? [a.id] : [], a?.band ?? 0, packHint(1, i));
    }
    log.knowers = world[i]; log.bands = bandsWith[i];
    if (keeper[i]) log.keeper = keeper[i];
  }
  for (const b of s.bands) {
    const old = before.get(b)!;
    for (let i = 0; i < TECH_COUNT; i++) {
      if (old.can[i] > 0 && b.can[i] === 0 && world[i] > 0) lostHere(s, b, i, old.keeper[i]);
      else if (old.can[i] === 0 && b.can[i] > 0 && !TECHS[i].start) brought(s, b, i);
    }
  }
}
function lostHere(s: Society, b: Band, i: number, keeper: number): void {
  if (TECHS[i].start && b.members.length < 3) return;
  const q = s.byId.get(keeper), a = s.archive.get(keeper);
  const text = q && q.band !== b.id ? `${q.name} left the ${b.name} for the ${s.band(q).name}, and took ${TECHS[i].how} along: nobody left among the ${b.name} knows it.`
    : a ? `With the death of ${a.name}, nobody among the ${b.name} knows ${TECHS[i].how} any more.`
    : `Nobody among the ${b.name} knows ${TECHS[i].how} any more.`;
  s.stats.ideas.lost++;
  s.event("lost", Bubble.Sad, text, b.x, b.y, keeper ? [keeper] : [], b.id, packHint(0, i));
}
function brought(s: Society, b: Band, i: number): void {
  /* whoever came most lately of those who know it */
  let by: Person | null = null;
  for (const id of b.members) { const q = s.byId.get(id); if (q && q.know[i] > 0 && (!by || q.joined > by.joined)) by = q; }
  if (!by) return;
  const from = s.bandById.get(by.came);
  s.event("spread", TECHS[i].icon, `${by.name}, who came to live with the ${b.name}${from ? ` from the ${from.name}` : ""}, brought ${TECHS[i].how} with ${herObj(by)}.`, b.x, b.y, [by.id], b.id, packHint(from && from.culture !== b.culture ? 1 : 0, i));
}

/* ---------------- for the interface ---------------- */

export interface IdeaSummary {
  id: number; name: string; how: string; start: boolean; needs: string[]; icon: number;
  knowers: number; bands: number; peoples: number; times: number; lostAt: number;
  first: IdeaLog["first"];
}
export function ideaSummary(s: Society): IdeaSummary[] {
  return TECHS.map(d => {
    const log = s.ideas[d.id];
    const peoples = new Set<number>(); for (const b of s.bands) if (b.can[d.id]) peoples.add(b.culture);
    return { id: d.id, name: d.name, how: d.how, start: d.start, needs: [...d.needs.map(n => TECHS[n].name), ...d.any.map(n => TECHS[n].name)], icon: d.icon, knowers: log.knowers, bands: log.bands, peoples: peoples.size, times: log.times, lostAt: log.lostAt, first: log.first };
  });
}

/** How someone came to know a thing, in words for their tag. */
export function howKnown(s: Society, p: Person, id: number): string {
  const f = p.from[id];
  if (f === -1) return "worked it out";
  if (f === -2) return "worked it out from one others made";
  if (!f) return "";
  const q = s.byId.get(f) ?? s.archive.get(f);
  if (!q) return "";
  const kin = q.id === p.mother ? "mother" : q.id === p.father ? "father" : q.id === p.partner ? (q.sex === "f" ? "wife" : "husband") : (q.mother === p.id || q.father === p.id) ? (q.sex === "f" ? "daughter" : "son") : "";
  return `from ${kin ? `${her(p)} ${kin}, ` : ""}${q.name}`;
}

/** Where and when food has to be dug for: the lean seasons everywhere, and the open grass and scrub, where roots and tubers are most of what there is. */
export function rootsAt(s: Society, x: number, y: number): boolean {
  if (s.season === 3 || s.season === 0) return true;
  const b = s.w.biome[(y | 0) * s.w.w + (x | 0)];
  return b === Biome.Grassland || b === Biome.ColdSteppe || b === Biome.Savanna || b === Biome.Shrubland;
}
/** A tile of fresh, flowing water near (x, y): rivers and the narrows where weirs are built. */
export function riverAt(s: Society, x: number, y: number): boolean {
  const W = s.w.w, i = (y | 0) * s.w.w + (x | 0);
  for (const d of [0, 1, -1, W, -W]) if (s.w.flags[i + d] & Flag.River) return true;
  return false;
}
