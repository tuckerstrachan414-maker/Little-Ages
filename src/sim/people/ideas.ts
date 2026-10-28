import { Biome, DAY_SECONDS, Flag } from "../../shared/types.ts";
import { Anim, Bubble } from "../../shared/people.ts";
import { Goal, Mem, St, Skill, type Person } from "./person.ts";
import { type Band } from "./band.ts";
import { feudOf } from "./feuds.ts";
import type { Society } from "./society.ts";

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
*/

export const Idea = {
  KeepFire: 0, Spear: 1, Fishing: 2, Hides: 3, Snares: 4,
  MakeFire: 5, Blades: 6, Axe: 7, Digging: 8, Baskets: 9, Nets: 10, Weirs: 11, Drying: 12, Planting: 13,
} as const;

export interface IdeaDef {
  id: number;
  /** "making fire" */
  name: string;
  /** "how to make fire", for "learned how to make fire" */
  how: string;
  /** a headline for the first time anyone works it out */
  title: string;
  /** what one has to know already */
  needs: number[];
  /** the age a child can start to pick it up, and how readily they do in a day with someone to learn from */
  age: number; child: number;
  /** how readily it is picked up by watching someone at it, each time one looks */
  watch: number;
  /** how readily someone who is shown takes it in */
  show: number;
  /** the skill it draws on */
  skill: number;
  /** how much it is worth passing on, to someone weighing what to show */
  worth: number;
  /** how rare a thought it is: the chance, at full need, that a piece of related work brings it to mind */
  spark: number;
  /** known everywhere when the story begins */
  start: boolean;
  /** how someone looks while showing it, and its picture */
  anim: number; icon: number;
}

export const IDEAS: IdeaDef[] = [
  { id: 0, name: "keeping fire", how: "how to keep a fire alive", title: "", needs: [], age: 6, child: 0.08, watch: 0.004, show: 0.5, skill: Skill.Craft, worth: 0.3, spark: 0, start: true, anim: Anim.Cook, icon: Bubble.Fire },
  { id: 1, name: "spear hunting", how: "how to hunt with a spear", title: "", needs: [], age: 11, child: 0.04, watch: 0.003, show: 0.4, skill: Skill.Hunt, worth: 0.35, spark: 0, start: true, anim: Anim.Knap, icon: Bubble.Deer },
  { id: 2, name: "fishing", how: "how to fish", title: "", needs: [], age: 7, child: 0.05, watch: 0.004, show: 0.5, skill: Skill.Fish, worth: 0.35, spark: 0, start: true, anim: Anim.Fish, icon: Bubble.Fish },
  { id: 3, name: "working hides", how: "how to work hides into clothes", title: "", needs: [], age: 9, child: 0.03, watch: 0.003, show: 0.45, skill: Skill.Craft, worth: 0.35, spark: 0, start: true, anim: Anim.Sew, icon: Bubble.Cold },
  { id: 4, name: "setting snares", how: "how to set snares", title: "", needs: [], age: 7, child: 0.05, watch: 0.004, show: 0.5, skill: Skill.Hunt, worth: 0.3, spark: 0, start: true, anim: Anim.Dig, icon: Bubble.Meat },
  { id: 5, name: "making fire", how: "how to make fire", title: "Fire from nothing", needs: [0], age: 10, child: 0.04, watch: 0.012, show: 0.35, skill: Skill.Craft, worth: 1, spark: 0.01, start: false, anim: Anim.Knap, icon: Bubble.Fire },
  { id: 6, name: "striking blades", how: "how to strike long blades from a flint core", title: "Long stone blades", needs: [1], age: 13, child: 0.03, watch: 0.008, show: 0.3, skill: Skill.Craft, worth: 0.6, spark: 0.0012, start: false, anim: Anim.Knap, icon: Bubble.Star },
  { id: 7, name: "stone axes", how: "how to grind and haft a stone axe", title: "The stone axe", needs: [6], age: 13, child: 0.03, watch: 0.008, show: 0.4, skill: Skill.Craft, worth: 0.55, spark: 0.003, start: false, anim: Anim.Chop, icon: Bubble.Star },
  { id: 8, name: "digging sticks", how: "how to dig roots with a fire-hardened stick", title: "The digging stick", needs: [], age: 6, child: 0.06, watch: 0.012, show: 0.7, skill: Skill.Gather, worth: 0.7, spark: 0.00012, start: false, anim: Anim.Dig, icon: Bubble.Berries },
  { id: 9, name: "weaving baskets", how: "how to weave baskets", title: "The first baskets", needs: [], age: 8, child: 0.05, watch: 0.01, show: 0.5, skill: Skill.Craft, worth: 0.7, spark: 0.0002, start: false, anim: Anim.Sew, icon: Bubble.Berries },
  { id: 10, name: "fishing nets", how: "how to knot a fishing net", title: "The fishing net", needs: [2, 4], age: 10, child: 0.04, watch: 0.01, show: 0.45, skill: Skill.Fish, worth: 0.8, spark: 0.0008, start: false, anim: Anim.Sew, icon: Bubble.Fish },
  { id: 11, name: "fish weirs", how: "how to build a fish weir", title: "The fish weir", needs: [2], age: 12, child: 0.03, watch: 0.008, show: 0.45, skill: Skill.Fish, worth: 0.65, spark: 0.002, start: false, anim: Anim.Chop, icon: Bubble.Fish },
  { id: 12, name: "drying meat", how: "how to dry meat and fish on racks", title: "Meat that keeps", needs: [0], age: 9, child: 0.05, watch: 0.012, show: 0.6, skill: Skill.Craft, worth: 0.75, spark: 0.0003, start: false, anim: Anim.Butcher, icon: Bubble.Meat },
  { id: 13, name: "planting", how: "how to plant", title: "The first planting", needs: [8], age: 8, child: 0.04, watch: 0.008, show: 0.5, skill: Skill.Gather, worth: 0.6, spark: 0.0015, start: false, anim: Anim.Dig, icon: Bubble.Berries },
];
export const IDEA_COUNT = IDEAS.length;

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
export const newIdeaLog = (s: Society): IdeaLog[] => IDEAS.map(d => ({ first: null, times: 0, cultures: d.start ? new Set(s.cultures.map((_, i) => i)) : new Set(), knowers: 0, bands: 0, keeper: 0, lostAt: 0 }));

const she = (p: Person) => (p.sex === "f" ? "she" : "he");
const She = (p: Person) => (p.sex === "f" ? "She" : "He");
const her = (p: Person) => (p.sex === "f" ? "her" : "his");
const herObj = (p: Person) => (p.sex === "f" ? "her" : "him");

export const knows = (p: Person, id: number) => p.know[id] > 0;
/** Whether someone knows all an idea builds on. */
export function ready(p: Person, id: number): boolean { for (const n of IDEAS[id].needs) if (p.know[n] <= 0) return false; return true; }
/** Practice makes better: how well someone knows a thing creeps up each time they do it. */
export function practice(p: Person, id: number, amt = 0.01): void { if (p.know[id] > 0) p.know[id] = Math.min(1, p.know[id] + amt); }
/** Whether anyone in a band knows it (counted each morning, and whenever someone learns). */
export const bandKnows = (b: Band, id: number) => b.can[id] > 0;

/** What a founder knows for their age: the old ways of their people, better the longer they have lived by them. */
export function founderKnow(age: number, adult: number): number[] {
  const k = new Array(IDEA_COUNT).fill(0);
  for (const d of IDEAS) {
    if (!d.start) continue;
    const at = d.id === Idea.KeepFire || d.id === Idea.Snares ? 8 : 12;
    if (age >= at) k[d.id] = Math.min(1, 0.25 + adult * 0.5 + Math.max(0, age - 30) * 0.008);
  }
  return k;
}

/* ---------------- working something out ---------------- */

/** What was going on when a piece of work ended, for judging whether a better way would occur to someone. */
export interface Ctx {
  /** gathering: more in the patch than they could carry; little to be had; roots and tubers to dig */
  full?: boolean; poor?: boolean; roots?: boolean;
  /** fishing: in a river or at a narrow channel */
  river?: boolean;
  /** butchering a kill too big to eat before it spoils */
  big?: boolean;
}
const DURING: Partial<Record<number, number[]>> = {
  [St.Knap]: [Idea.MakeFire, Idea.Blades], [St.Kindle]: [Idea.MakeFire], [St.Craft]: [Idea.MakeFire],
  [St.Wood]: [Idea.Axe], [St.Gather]: [Idea.Digging, Idea.Baskets, Idea.Planting], [St.Fish]: [Idea.Nets, Idea.Weirs],
  [St.Butcher]: [Idea.Drying, Idea.Blades], [St.Cook]: [Idea.Drying],
};

/** How good a person is at seeing a new way: curiosity most, then skill in that line of work, and the years of their life. */
function aptitude(p: Person, id: number, age: number): number {
  const cur = p.traits[4];
  return (0.2 + 2.2 * cur * cur) * (0.55 + p.skills[IDEAS[id].skill] * 0.9) * (0.85 + p.traits[7] * 0.3) * (age < 16 ? 0.6 : age < 50 ? 1 : 0.7);
}

/** How badly the person (and their band) needs a better way right now, 0..1. Without need, ideas seldom come. */
function pressure(s: Society, p: Person, id: number, k: number, c: Ctx): number {
  const b = s.band(p), out = b.fire <= 0, T = s.tempC(p.x, p.y);
  const short = Math.max(0, Math.min(1, 1 - (b.appetite > 0 ? (b.store.plant + b.store.meat + b.store.fish + b.store.dried) / b.appetite : 9) / 2));
  const hungry = Math.max(0, Math.min(1, 1 - p.food / 1.4));
  const fireLost = p.mem.some(m => m.k === Mem.FireOut && s.time - m.t < DAY_SECONDS * 30);
  switch (id) {
    case Idea.MakeFire:
      if (k === St.Kindle) return 1;
      return out ? (k === St.Knap ? 0.8 : 0.4) : fireLost ? 0.25 : 0.03;
    case Idea.Blades: return k === St.Knap ? 0.2 + (p.spear <= 0 ? 0.4 : 0) + hungry * 0.2 : 0.1;
    case Idea.Axe: return 0.1 + (T < 8 ? 0.35 : 0) + (b.store.wood < 2 ? 0.3 : 0);
    case Idea.Digging: return (c.roots ? 0.45 : 0.08) + short * 0.35 + (c.poor ? 0.2 : 0);
    case Idea.Baskets: return (c.full ? 0.55 : 0.08) + short * 0.25;
    case Idea.Planting: {
      /* sprouts come up where seeds were spilled at a camp lived in long enough to see it */
      if (Math.hypot(p.x - b.x, p.y - b.y) > 12) return 0;
      const stay = Math.max(0, Math.min(1, (s.time - b.movedAt) / (DAY_SECONDS * 25)));
      return (0.05 + short * 0.5) * (0.3 + stay * 0.7) * (s.season === 0 ? 1.5 : 1);
    }
    case Idea.Nets: return (c.poor ? 0.45 : 0.1) + short * 0.35;
    case Idea.Weirs: return c.river ? 0.35 + short * 0.35 : 0.05;
    case Idea.Drying: {
      if (k === St.Butcher) return c.big ? 0.5 + (T > 10 ? 0.3 : 0) : 0;
      const rot = b.yesterday.spoiled / Math.max(2, b.appetite * 0.6);
      return Math.min(1, rot) * 0.8;
    }
  }
  return 0;
}

/** A piece of work done: someone in the middle of it may see a better way. */
export function inspire(s: Society, p: Person, k: number, c: Ctx = {}): boolean {
  const list = DURING[k]; if (!list) return false;
  const age = s.age(p); if (age < 12) return false;
  for (const id of list) {
    if (p.know[id] > 0 || !ready(p, id)) continue;
    const pr = pressure(s, p, id, k, c); if (pr <= 0) continue;
    if (s.rng.chance(IDEAS[id].spark * pr * aptitude(p, id, age))) { discover(s, p, id, k, c); return true; }
  }
  return false;
}

/** How a discovery happened, in words. */
function story(s: Society, p: Person, id: number, k: number, c: Ctx): string {
  const b = s.band(p), T = s.tempC(b.x, b.y);
  switch (id) {
    case Idea.MakeFire: return k === St.Kindle
      ? `${p.name} of the ${b.name} was trying to bring back the dead fire${T < 6 ? " in the cold" : ""}, twirling a stick hard into a notch of dry wood, when smoke curled up and the tinder caught. ${She(p)} can make fire from nothing.`
      : k === St.Knap ? `${p.name} of the ${b.name} was striking stones${b.fire <= 0 ? " by the cold hearth" : ""} when a spark leapt into a tuft of dry moss and caught. ${She(p)} can make fire from nothing.`
      : `${p.name} of the ${b.name} was boring holes with a stick when the wood grew hot enough to smoke. ${She(p)} worked out how to make fire from nothing.`;
    case Idea.Blades: return `${p.name} of the ${b.name} was knapping a spear point when ${she(p)} found that a core struck just so gives long, keen blades: better points that break less, and knives that cut clean.`;
    case Idea.Axe: return `${p.name} of the ${b.name}, breaking branches for the fire${T < 8 ? " against the cold" : ""}, ground a stone to an edge and bound it to a handle: an axe that fells what hands cannot break.`;
    case Idea.Digging: return `${p.name} of the ${b.name}, scrabbling for ${c.roots ? "roots in hard ground" : "food where little was to be had"}, hardened a stick in the fire and dug with it. Roots and tubers that were out of reach can be had now.`;
    case Idea.Baskets: return `${p.name} of the ${b.name}, with more food in the patch than ${she(p)} could carry home, wove grass and reeds into a basket.`;
    case Idea.Nets: return `${p.name} of the ${b.name}, catching little at the water, knotted cord into a mesh and drew it through the shallows: a net, full of fish.`;
    case Idea.Weirs: return `${p.name} of the ${b.name} saw fish crowding the shallows of the ${c.river ? "river" : "water"} and drove in a fence of stakes to trap them: a weir that fishes while its makers sleep.`;
    case Idea.Drying: return `${p.name} of the ${b.name}, with ${c.big ? "more meat from the kill than anyone could eat" : "meat going bad at camp"}, cut it into thin strips and hung them over the smoke. Dried, it keeps for months.`;
    case Idea.Planting: return `${p.name} of the ${b.name} noticed shoots coming up where seeds had been spilled around camp, and pushed seeds into the ground on purpose. If the band stays, they will come up.`;
  }
  return `${p.name} of the ${b.name} worked out ${IDEAS[id].how}.`;
}

export function discover(s: Society, p: Person, id: number, k: number, c: Ctx = {}): void {
  const d = IDEAS[id], b = s.band(p), log = s.ideas[id], cult = s.cultures[b.culture];
  const level = !log.times && !log.knowers ? 2 : !log.cultures.has(b.culture) ? 1 : 0;
  p.know[id] = 0.35; p.from[id] = -1;
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
  s.event("discover", d.icon, story(s, p, id, k, c) + tail, p.x, p.y, [p.id], b.id, level * 100 + id);
}

/* ---------------- passing it on ---------------- */

/** Learning something from someone (or, with no teacher, from what one has seen). */
export function learn(s: Society, p: Person, id: number, teacher: Person | null, how: "child" | "watch" | "shown" | "told" | "seen"): void {
  if (p.know[id] > 0) return;
  const tm = teacher ? teacher.know[id] : 0.25;
  p.know[id] = Math.max(0.12, Math.min(0.6, 0.1 + tm * 0.4));
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
  }
  /* the first of a band to know a thing, learned from someone of another band */
  if (fresh && !IDEAS[id].start && teacher && teacher.band !== p.band) {
    const tb = s.band(teacher);
    s.event("spread", IDEAS[id].icon, `${p.name} of the ${b.name} learned ${IDEAS[id].how} from ${teacher.name} of the ${tb.name}${how === "watch" ? `, watching ${herObj(teacher)} at it` : ""}. ${She(p)} is the first of the ${b.name} to know it.`, p.x, p.y, [p.id, teacher.id], b.id, (tb.culture !== b.culture ? 100 : 0) + id);
  } else if (fresh && !IDEAS[id].start && !teacher && how === "seen") {
    s.event("spread", IDEAS[id].icon, `${p.name} of the ${b.name} worked out ${IDEAS[id].how} from one left standing by others. ${She(p)} is the first of the ${b.name} to know it.`, p.x, p.y, [p.id], b.id, id);
  }
}

/** Growing up: children pick up what the grown-ups around them know, from their parents first and then anyone in the band. What nobody in the band knows, nobody can learn. */
export function growUp(s: Society, p: Person, age: number): void {
  const b = s.band(p);
  for (const d of IDEAS) {
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
    case St.Cook: return [Idea.KeepFire];
  }
  return [];
}

/** Watching others at work, close by: now and then the trick of it sinks in. */
export function watch(s: Society, p: Person): void {
  const age = s.age(p); if (age < 5 || p.goal === Goal.Sleep) return;
  for (const q of s.near(p.x, p.y, 3.5)) {
    if (q === p || q.carrier) continue;
    for (const id of inUse(q)) {
      const d = IDEAS[id];
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
    for (const d of IDEAS) {
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
  const d = IDEAS[id]; if (!d || b.know[id] > 0 || !ready(b, id)) return;
  practice(a, id, 0.01);
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
    const id = IDEAS.find(d => from.know[d.id] >= 0.25 && to.know[d.id] <= 0 && age >= d.age && ready(to, d.id) && !d.start)?.id;
    if (id !== undefined && s.rng.chance(IDEAS[id].show * (0.4 + to.traits[4] * 0.6))) { learn(s, to, id, from, "told"); return; }
  }
}

/* ---------------- what each band knows, and what it loses ---------------- */

/** Counts who knows what in a band, and the one who knows each best. */
export function countBand(s: Society, b: Band): void {
  const can = new Array(IDEA_COUNT).fill(0), keeper = new Array(IDEA_COUNT).fill(0), best = new Array(IDEA_COUNT).fill(0);
  for (const id of b.members) {
    const q = s.byId.get(id); if (!q) continue;
    for (let i = 0; i < IDEA_COUNT; i++) if (q.know[i] > 0) { can[i]++; if (q.know[i] > best[i]) { best[i] = q.know[i]; keeper[i] = q.id; } }
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
  const world = new Array(IDEA_COUNT).fill(0), bandsWith = new Array(IDEA_COUNT).fill(0), keeper = new Array(IDEA_COUNT).fill(0), best = new Array(IDEA_COUNT).fill(0);
  const before = new Map<Band, { can: number[]; keeper: number[] }>();
  for (const b of s.bands) {
    before.set(b, { can: b.can, keeper: b.keeper });
    countBand(s, b);
    for (let i = 0; i < IDEA_COUNT; i++) {
      world[i] += b.can[i]; if (b.can[i]) bandsWith[i]++;
      const q = s.byId.get(b.keeper[i]); if (q && q.know[i] > best[i]) { best[i] = q.know[i]; keeper[i] = q.id; }
    }
  }
  for (let i = 0; i < IDEA_COUNT; i++) {
    const log = s.ideas[i];
    if (log.knowers > 0 && world[i] === 0) {
      log.lostAt = s.time;
      const a = s.archive.get(log.keeper), ab = a ? s.bandById.get(a.band) : undefined;
      const text = a ? `${a.name}${ab ? ` of the ${ab.name}` : ""} has died, the last who knew ${IDEAS[i].how}.` : "";
      s.event("lost", Bubble.Sad, `${text ? text + " " : ""}Nobody anywhere knows ${IDEAS[i].how} any more.`, a?.x ?? 0, a?.y ?? 0, a ? [a.id] : [], a?.band ?? 0, 100 + i);
    }
    log.knowers = world[i]; log.bands = bandsWith[i];
    if (keeper[i]) log.keeper = keeper[i];
  }
  for (const b of s.bands) {
    const old = before.get(b)!;
    for (let i = 0; i < IDEA_COUNT; i++) {
      if (old.can[i] > 0 && b.can[i] === 0 && world[i] > 0) lostHere(s, b, i, old.keeper[i]);
      else if (old.can[i] === 0 && b.can[i] > 0 && !IDEAS[i].start) brought(s, b, i);
    }
  }
}
function lostHere(s: Society, b: Band, i: number, keeper: number): void {
  if (IDEAS[i].start && b.members.length < 3) return;
  const q = s.byId.get(keeper), a = s.archive.get(keeper);
  const text = q && q.band !== b.id ? `${q.name} left the ${b.name} for the ${s.band(q).name}, and took ${IDEAS[i].how} along: nobody left among the ${b.name} knows it.`
    : a ? `With the death of ${a.name}, nobody among the ${b.name} knows ${IDEAS[i].how} any more.`
    : `Nobody among the ${b.name} knows ${IDEAS[i].how} any more.`;
  s.stats.ideas.lost++;
  s.event("lost", Bubble.Sad, text, b.x, b.y, keeper ? [keeper] : [], b.id, i);
}
function brought(s: Society, b: Band, i: number): void {
  /* whoever came most lately of those who know it */
  let by: Person | null = null;
  for (const id of b.members) { const q = s.byId.get(id); if (q && q.know[i] > 0 && (!by || q.joined > by.joined)) by = q; }
  if (!by) return;
  const from = s.bandById.get(by.came);
  s.event("spread", IDEAS[i].icon, `${by.name}, who came to live with the ${b.name}${from ? ` from the ${from.name}` : ""}, brought ${IDEAS[i].how} with ${herObj(by)}.`, b.x, b.y, [by.id], b.id, (from && from.culture !== b.culture ? 100 : 0) + i);
}

/* ---------------- for the interface ---------------- */

export interface IdeaSummary {
  id: number; name: string; how: string; start: boolean; needs: string[]; icon: number;
  knowers: number; bands: number; peoples: number; times: number; lostAt: number;
  first: IdeaLog["first"];
}
export function ideaSummary(s: Society): IdeaSummary[] {
  return IDEAS.map(d => {
    const log = s.ideas[d.id];
    const peoples = new Set<number>(); for (const b of s.bands) if (b.can[d.id]) peoples.add(b.culture);
    return { id: d.id, name: d.name, how: d.how, start: d.start, needs: d.needs.map(n => IDEAS[n].name), icon: d.icon, knowers: log.knowers, bands: log.bands, peoples: peoples.size, times: log.times, lostAt: log.lostAt, first: log.first };
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
  const W = s.w.w, i = (y | 0) * W + (x | 0);
  for (const d of [0, 1, -1, W, -W]) if (s.w.flags[i + d] & Flag.River) return true;
  return false;
}
