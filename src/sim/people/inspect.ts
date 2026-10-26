import { DAY_SECONDS, SPECIES_NAMES } from "../../shared/types.ts";
import type { BandDetail, Kin, PersonDetail } from "../../shared/protocol.ts";
import { TRAITS } from "./genetics.ts";
import { Goal, KNOW_NAMES, Mem, SKILL_NAMES, kinWord, type Person } from "./person.ts";
import { storeFood } from "./band.ts";
import type { Society } from "./society.ts";

/*
  Turning a mind into words for the pinned tag: what someone is doing and why, how they
  feel, what they are like, who their family is, who they love and who they cannot stand,
  and what they remember.
*/

const GOAL_WORDS: Partial<Record<number, string>> = {
  [Goal.Sleep]: "Sleeping", [Goal.Drink]: "Getting water", [Goal.Eat]: "Eating", [Goal.Gather]: "Gathering", [Goal.Fish]: "Fishing",
  [Goal.Snare]: "Setting snares", [Goal.Hunt]: "Hunting", [Goal.Haul]: "Hauling meat", [Goal.Wood]: "Fetching firewood", [Goal.Warm]: "Warming up",
  [Goal.Talk]: "Talking", [Goal.Court]: "Courting", [Goal.Play]: "Playing", [Goal.Follow]: "Learning", [Goal.Explore]: "Exploring",
  [Goal.Craft]: "Sewing clothes", [Goal.Spear]: "Making a spear", [Goal.Tend]: "Caring for the sick", [Goal.Rest]: "Resting", [Goal.Flee]: "Fleeing",
  [Goal.Migrate]: "Moving camp", [Goal.Carried]: "Being carried", [Goal.Sick]: "Sick in bed", [Goal.Toddle]: "Toddling about", [Goal.Visit]: "Visiting",
};
const TRAIT_WORDS: [string, string][] = [
  ["timid", "brave"], ["cold", "kind"], ["generous", "greedy"], ["easygoing", "ambitious"],
  ["cautious", "curious"], ["shy", "outgoing"], ["calm", "hot-tempered"], ["lazy", "hardworking"],
];

function kin(s: Society, p: Person, id: number, rel?: string): Kin | null {
  if (!id) return null;
  const q = s.byId.get(id);
  if (q) return { id, name: q.name, rel: rel ?? kinWord(p, id, q) ?? "", alive: true, age: Math.floor(s.age(q)), sex: q.sex, op: s.op(p, id), look: s.look_(q), band: q.band === p.band ? "" : s.bandById.get(q.band)?.name ?? "" };
  const a = s.archive.get(id);
  if (a) return { id, name: a.name, rel: rel ?? kinWord(p, id, a) ?? "", alive: false, age: Math.floor((a.died - a.born) / 2400), sex: a.sex, op: s.op(p, id), died: a.cause, band: "" };
  return null;
}

function memoryText(s: Society, p: Person, m: Person["mem"][number]): string {
  const who = m.who ? s.byId.get(m.who)?.name ?? s.archive.get(m.who)?.name ?? "someone" : "";
  const rel = m.who ? (() => { const q = s.byId.get(m.who) ?? s.archive.get(m.who); return q ? kinWord(p, m.who, q) : null; })() : null;
  const whoRel = rel ? `${p.sex === "f" ? "her" : "his"} ${rel}, ${who}` : who;
  switch (m.k) {
    case Mem.Argued: return `Quarreled with ${who}`;
    case Mem.NiceTalk: return `A good talk with ${who}`;
    case Mem.Stranger: return `Met ${who}, a stranger`;
    case Mem.Kill: return m.who === p.id ? `Brought down a ${SPECIES_NAMES[m.n]?.toLowerCase() ?? "beast"}` : `Hunted with ${who} and made a kill`;
    case Mem.Attacked: return `Attacked by ${m.n === 5 ? "a bear" : "wolves"}`;
    case Mem.Injured: return `Hurt on a hunt`;
    case Mem.Birth: return `${who} was born`;
    case Mem.Death: return `Lost ${whoRel}`;
    case Mem.Paired: return `Became a couple with ${who}`;
    case Mem.Parted: return `Parted from ${who}`;
    case Mem.Moved: return `Moved camp`;
    case Mem.Split: return `Left with ${who} to start a new band`;
    case Mem.Learned: return `Learned ${KNOW_NAMES.find(([b]) => b === m.n)?.[1] ?? "something new"} from ${who}`;
    case Mem.Found: return `Found good land while exploring`;
    case Mem.Rejected: return `Was turned down by ${who}`;
    case Mem.Freeloader: return `Noticed ${who} eats without bringing food`;
    case Mem.Helped: return `${who} looked after ${p.sex === "f" ? "her" : "him"}`;
    default: return "";
  }
}

export function personDetail(s: Society, id: number): PersonDetail | null {
  const p = s.byId.get(id);
  if (!p) return null;
  const age = s.age(p), b = s.band(p), cult = s.culture(p);
  const moodWord = p.mood > 0.55 ? "Happy" : p.mood > 0.25 ? "Content" : p.mood > 0 ? "Uneasy" : p.mood > -0.3 ? "Unhappy" : "Miserable";
  const feelings: string[] = [];
  if (p.mem.some(m => m.k === Mem.Death && s.time - m.t < DAY_SECONDS * 8)) feelings.push("grieving");
  if (p.fear > 0.4) feelings.push("afraid");
  if (p.mem.some(m => m.k === Mem.Argued && s.time - m.t < DAY_SECONDS * 2)) feelings.push("angry");
  if (p.mem.some(m => m.k === Mem.Paired && s.time - m.t < DAY_SECONDS * 15) || p.goal === Goal.Court) feelings.push("in love");
  if (p.food < 0.4) feelings.push("starving"); else if (p.food < 0.8) feelings.push("hungry");
  if (p.warmth < 0.4) feelings.push("freezing");
  if (p.sick > 0) feelings.push("feverish");
  if (p.injury > 0.3) feelings.push("hurt");
  if (p.longing > 0.6 && !p.partner) feelings.push("lonely for love");
  const traits = p.traits.map((v, i) => ({ word: TRAIT_WORDS[i][v >= 0.5 ? 1 : 0], v, key: TRAITS[i], strength: Math.abs(v - 0.5) })).sort((a, c) => c.strength - a.strength);
  const siblings = s.people.filter(q => q !== p && ((p.mother && q.mother === p.mother) || (p.father && q.father === p.father))).map(q => kin(s, p, q.id)!).filter(Boolean);
  const rels = [...p.rel].filter(([oid]) => oid !== p.partner && oid !== p.mother && oid !== p.father && !p.children.includes(oid) && s.byId.has(oid));
  const friends = rels.filter(([, r]) => r.op > 0.45).sort((a, c) => c[1].op - a[1].op).slice(0, 4).map(([oid]) => kin(s, p, oid, "friend")!).filter(Boolean);
  const rivals = rels.filter(([, r]) => r.op < -0.2).sort((a, c) => a[1].op - c[1].op).slice(0, 3).map(([oid]) => kin(s, p, oid, "rival")!).filter(Boolean);
  const memories = p.mem.slice().sort((a, c) => c.t - a.t).slice(0, 8).map(m => ({ text: memoryText(s, p, m), ago: (s.time - m.t) / DAY_SECONDS, v: m.v })).filter(m => m.text);
  const carrying = p.carryAmt > 0.2 ? `${p.carryAmt.toFixed(0)} ${["", "plant food", "meat", "fish", "firewood"][p.carryKind] ?? "things"}` : "";
  return {
    id, name: p.name, sex: p.sex, age, stage: s.stage(p), band: { id: b.id, name: b.name }, people: cult.lang.name,
    doing: GOAL_WORDS[p.goal] ?? "Idle", why: p.why || `${p.name} is looking around.`,
    needs: { food: Math.min(1, p.food / 1.6), water: p.water, rest: p.rest, warmth: p.warmth, company: p.company, safety: 1 - p.fear, health: p.health },
    mood: p.mood, moodWord, feelings,
    traits: traits.slice(0, 3).map(t => ({ word: t.word, v: t.v, key: t.key })),
    skills: p.skills.map((v, i) => ({ name: SKILL_NAMES[i], v })),
    knows: KNOW_NAMES.filter(([bit]) => p.knows & bit).map(([, n]) => n),
    looks: s.describeLooks(p), look: s.look_(p),
    mother: kin(s, p, p.mother), father: kin(s, p, p.father), partner: kin(s, p, p.partner),
    children: p.children.map(c => kin(s, p, c)!).filter(Boolean), siblings, friends, rivals, memories,
    pregnant: !!p.pregnantBy, carrying, prestige: p.prestige, respected: b.respected === p.id,
    x: p.x, y: p.y,
  };
}

export function bandDetail(s: Society, id: number): BandDetail | null {
  const b = s.bandById.get(id);
  if (!b) return null;
  const ms = b.members.map(m => s.byId.get(m)).filter((q): q is Person => !!q);
  const cult = s.cultures[b.culture];
  const resp = s.byId.get(b.respected);
  const couples = ms.filter(q => q.sex === "f" && q.partner && s.byId.get(q.partner)?.band === b.id).length;
  return {
    id, name: b.name, people: cult.lang.name, pop: ms.length,
    adults: ms.filter(q => s.age(q) >= 16).length, children: ms.filter(q => s.age(q) < 16).length, couples,
    respected: resp ? { id: resp.id, name: resp.name } : null,
    store: { plant: Math.round(b.store.plant), meat: Math.round(b.store.meat), fish: Math.round(b.store.fish), wood: Math.round(b.store.wood), hides: Math.round(b.store.hides) },
    days: storeFood(b.store) / Math.max(1, b.appetite), fire: b.fire, moves: b.moves, camp: b.siteName,
    yesterday: { brought: Math.round(b.yesterday.plant + b.yesterday.meat + b.yesterday.fish), eaten: Math.round(b.yesterday.eaten) },
    shelter: cult.shelter, sharing: cult.sharing, cousins: cult.cousins,
    sample: [cult.lang.name, ...ms.slice(0, 5).map(q => q.name)],
    members: ms.sort((a, c) => s.age(c) - s.age(a)).map(q => ({ id: q.id, name: q.name, age: Math.floor(s.age(q)), sex: q.sex, look: s.look_(q) })),
    events: s.events.filter(e => e.band === b.id).slice(-6).reverse(),
    x: b.x, y: b.y, moving: !!b.moving,
  };
}
