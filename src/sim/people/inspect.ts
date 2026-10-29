import { defOf } from "../buildings/build.ts";
import { dietWords } from "../economy/diet.ts";
import { Mat } from "../economy/goods.ts";
import { WALL_WORDS } from "../buildings/defs.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASON_NAMES, SPECIES_NAMES } from "../../shared/types.ts";
import type { BandDetail, BandFeud, Feuding, Kin, PersonDetail, VillageDetail } from "../../shared/protocol.ts";
import { TRAITS } from "./genetics.ts";
import { Goal, Mem, SKILL_NAMES, St, kinWord, type Person } from "./person.ts";
import { storeFood, campFood, homeOf, type Band } from "./band.ts";
import { howKnown } from "./ideas.ts";
import { TECHS as IDEAS, Idea } from "../tech/tree.ts";
import { Work, worksAround } from "./works.ts";
import { pitFood, pitOf, hutOf, hutWords } from "./homes.ts";
import { villageOf } from "./villages.ts";
import { RIVAL_OP } from "./search.ts";
import { hearthDays, household, appetiteOf, householdAppetite } from "./sharing.ts";
import { feudsWith, sideOf } from "./feuds.ts";
import { followersOf, leads } from "./leaders.ts";
import type { Society } from "./society.ts";
import { needsLine } from "../tech/problems.ts";

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
  [Goal.Ask]: "Asking for food", [Goal.Fight]: "Fighting", [Goal.Mediate]: "Making peace", [Goal.Call]: "Visiting friends",
  [Goal.Kindle]: "Lighting the fire", [Goal.Ember]: "Fetching fire", [Goal.Show]: "Showing how", [Goal.Learn]: "Learning", [Goal.Dry]: "Drying meat",
  [Goal.Build]: "Building a weir", [Goal.Sow]: "Sowing",
  [Goal.Hut]: "Raising a hut", [Goal.Pit]: "Digging a storage pit", [Goal.Store]: "Putting food by", [Goal.Fetch]: "Fetching food from the pit",
  [Goal.Quarry]: "Fetching clay and stone", [Goal.Construct]: "Building", [Goal.Pot]: "Making pots",
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
  const her = p.sex === "f" ? "her" : "him", she = p.sex === "f" ? "she" : "he";
  switch (m.k) {
    case Mem.Fed: return `${who} gave ${her} food in a hungry time`;
    case Mem.Refused: return `${who} turned ${her} away when ${she} asked for food`;
    case Mem.Repaid: return `${who} paid back the food ${she} gave`;
    case Mem.Stingy: return `Saw ${who} keep food from a hungry family`;
    case Mem.Fight: return `Came to blows with ${who}`;
    case Mem.Peace: return `Made peace with ${who}`;
    case Mem.Feud: return `Bad blood with ${who}`;
    case Mem.Gift: return `${who} brought ${her} a gift`;
    case Mem.Mocked: return `${who} made fun of ${p.sex === "f" ? "her" : "his"} kill`;
    case Mem.Left: return `${who} left ${her} for someone else`;
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
    case Mem.Learned: return `Learned ${IDEAS[m.n]?.how ?? "something new"} from ${whoRel}`;
    case Mem.Discovered: return `Worked out ${IDEAS[m.n]?.how ?? "something new"}`;
    case Mem.Taught: return `Showed ${who} ${IDEAS[m.n]?.how ?? "how it is done"}`;
    case Mem.FireOut: return `The fire went out`;
    case Mem.Harvest: return `Brought in the harvest`;
    case Mem.Found: return m.n ? `Saw how others had made a ${m.n === Idea.Weirs ? "fish weir" : m.n === Idea.Huts ? "hut" : m.n === Idea.Pits ? "storage pit" : "planted plot"}, and worked it out` : `Found good land while exploring`;
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
  const rivals = rels.filter(([, r]) => r.op < RIVAL_OP).sort((a, c) => a[1].op - c[1].op).slice(0, 3).map(([oid]) => kin(s, p, oid, "rival")!).filter(Boolean);
  const memories = p.mem.slice().sort((a, c) => c.t - a.t).slice(0, 8).map(m => ({ text: memoryText(s, p, m), ago: (s.time - m.t) / DAY_SECONDS, v: m.v })).filter(m => m.text);
  const carrying = p.carryAmt > 0.2 ? `${p.carryAmt.toFixed(0)} ${["", "plant food", "meat", "fish", "firewood"][p.carryKind] ?? "things"}` : "";
  return {
    id, name: p.name, sex: p.sex, age, stage: s.stage(p), band: { id: b.id, name: b.name }, people: cult.lang.name,
    doing: doingWord(p), why: p.why || `${p.name} is looking around.`,
    needs: { food: Math.min(1, p.food / 1.6), water: p.water, rest: p.rest, warmth: p.warmth, company: p.company, safety: 1 - p.fear, health: p.health },
    mood: p.mood, moodWord, feelings,
    traits: traits.slice(0, 3).map(t => ({ word: t.word, v: t.v, key: t.key })),
    skills: p.skills.map((v, i) => ({ name: SKILL_NAMES[i], v })),
    knows: IDEAS.filter(d => p.know[d.id] > 0).map(d => ({ id: d.id, name: d.name, m: p.know[d.id], how: howKnown(s, p, d.id), start: d.start })),
    looks: s.describeLooks(p), look: s.look_(p), diet: age < 2 ? "" : dietWords(p),
    mother: kin(s, p, p.mother), father: kin(s, p, p.father), partner: kin(s, p, p.partner),
    children: p.children.map(c => kin(s, p, c)!).filter(Boolean), siblings, friends, rivals, memories,
    pregnant: !!p.pregnantBy, carrying, prestige: p.prestige, respected: b.respected === p.id,
    hearth: hearthDays(s, p), pot: storeFood(b.store) / Math.max(1, b.appetite),
    ...homeOfPerson(s, p, b),
    follows: p.follows && p.follows !== p.id && s.byId.has(p.follows) ? { id: p.follows, name: s.byId.get(p.follows)!.name } : null,
    followers: followersOf(s, p), leads: leads(s, p), shareRate: p.shareRate,
    feuds: feudsOf(s, p), owes: debts(s, p),
    x: p.x, y: p.y,
  };
}
function doingWord(p: Person): string {
  if (p.goal === Goal.Kindle) { const st = p.plan[p.si]; return st && st.k === St.Kindle && st.a === 1 ? "Lighting the fire" : p.know[Idea.MakeFire] > 0 ? "Making fire" : "Trying to make fire"; }
  if (p.goal === Goal.Ember && p.ember) return "Carrying fire home";
  return GOAL_WORDS[p.goal] ?? "Idle";
}
function feudsOf(s: Society, p: Person): Feuding[] {
  const out: Feuding[] = [];
  for (const f of feudsWith(s, p)) {
    const side = sideOf(s, f, p), otherId = side === 1 ? f.b : f.a, other = s.byId.get(otherId);
    if (!other) continue;
    const own = p.id === f.a || p.id === f.b;
    /* the cause is said of b, and reads the same from either side */
    const lead = s.byId.get(f.a)?.name ?? "", tail = s.byId.get(f.b)?.name ?? "";
    const cause = `${lead} will not forgive ${tail}, who ${f.cause}`;
    out.push({ id: other.id, name: other.name, heat: f.heat, cause, days: (s.time - f.since) / 60, own, inherited: f.inherited, look: s.look_(other) });
  }
  return out;
}
function debts(s: Society, p: Person): { id: number; name: string; amt: number }[] {
  return [...p.rel].filter(([id, r]) => Math.abs(r.owe) >= 0.5 && s.byId.has(id)).sort((a, c) => Math.abs(c[1].owe) - Math.abs(a[1].owe)).slice(0, 3).map(([id, r]) => ({ id, name: s.byId.get(id)!.name, amt: r.owe }));
}

function workText(s: Society, band: number, w: Work): string {
  if (w.kind === Work.Weir) {
    const state = w.state > 0.7 ? "in good repair" : w.state > 0.35 ? "knocked about by the water" : w.state > 0 ? "falling apart" : "washed out";
    return `${w.band === band ? "A fish weir" : "An old fish weir others left"}, ${state}${w.food >= 1 ? `, with ${Math.round(w.food)} days of fish in its trap` : ""}.`;
  }
  const who = s.byId.get(w.by)?.name ?? s.archive.get(w.by)?.name ?? "someone";
  const years = (w.sown ?? 1) > 1 ? `, sown ${w.sown} years` : "";
  if (w.fallow) return `${who}'s field of ${w.crop}${years}, resting until the spring sowing${(w.fert ?? 1) < 0.6 ? `; the soil is tired` : ""}.`;
  if (w.ripe < 0) return `${who}'s patch of ${w.crop}, killed by the frost before it ripened.`;
  if (w.state >= 1) return w.food >= 1 ? `${who}'s patch of ${w.crop}, ripe, with ${Math.round(w.food)} days of food standing.` : `${who}'s patch of ${w.crop}, harvested.`;
  const days = Math.max(1, Math.round((1 - w.state) / 0.038));
  return `${who}'s patch of ${w.crop}, ${w.state < 0.25 ? "just sprouting" : w.state < 0.6 ? "growing" : "nearly ripe"}: ripe in about ${days} days.`;
}

/** Where someone's household lives, in words, and the days of food in its pit. */
function homeOfPerson(s: Society, p: Person, b: Band): { home: string; pit: number } {
  const head = homeOf(p, s.byId, s.time), hut = hutOf(s, b, head), pit = pitOf(s, b, head);
  const home = b.moving ? "on the move" : !hut ? `a ${s.cultures[b.culture].shelter === "leanto" ? "lean-to" : s.cultures[b.culture].shelter === "tent" ? "hide tent" : "dome of grass"}` : (hut.prog ?? 1) < 1 ? `a ${hutWords(hut)} going up, ${Math.round((hut.prog ?? 0) * 100)}% done` : hut.state < 0.2 ? `a fallen-in ${hutWords(hut)}` : `a ${hutWords(hut)}${(hut.size ?? 1) > 1 ? ` of ${hut.size} bays` : ""}${hut.up ? ", being rebuilt" : ""}`;
  const pots = Math.floor(b.hgoods.get(head)?.[Mat.Pots] ?? 0);
  return { home: pots > 0 ? `${home}, with ${pots} ${pots === 1 ? "pot" : "pots"}` : home, pit: pit ? pitFood(pit) / householdAppetite(s, b, head) : -1 };
}
/** "spring of year 4" */
export const seasonYear = (t: number) => `${SEASON_NAMES[Math.floor(t / DAY_SECONDS / DAYS_PER_SEASON) % 4].toLowerCase()} of year ${Math.floor(t / DAY_SECONDS / DAYS_PER_YEAR) + 1}`;
/** The band's huts and pits at this camp, in a line. */
function homesLine(s: Society, b: Band): string {
  if (b.moving) return "";
  let huts = 0, going = 0, ruins = 0, bays = 0, pits = 0, granaries = 0, food = 0, rebuilt = 0, rebuilding = 0, wallsOf = "";
  const others = new Map<string, { up: number; going: number }>();
  for (const w of worksAround(s, b.x, b.y, 14)) {
    if (w.kind === Work.Hut) { if ((w.prog ?? 1) < 1) going++; else if (w.state < 0.2) ruins++; else { huts++; bays += Math.max(0, (w.size ?? 1) - 1); if ((w.tier ?? 0) >= 1) { rebuilt++; wallsOf ||= WALL_WORDS[w.walls ?? "poles"]; } if (w.up) rebuilding++; } }
    else if (w.kind === Work.Pit && w.band === b.id) { if ((w.tier ?? 0) >= 1) granaries++; else pits++; food += pitFood(w); }
    else if (w.kind >= 4 && (w.band === b.id || (w.owner ?? 0) >= 1)) { const d = defOf(w), o = others.get(d.name) ?? { up: 0, going: 0 }; if ((w.prog ?? 1) < 1) o.going++; else if (w.state > 0.2) o.up++; others.set(d.name, o); }
  }
  const parts: string[] = [];
  if (huts || going) parts.push(`${huts} ${huts === 1 ? "hut" : "huts"}${rebuilt ? ` (${rebuilt} rebuilt in ${wallsOf})` : ""}${bays ? ` (${bays} added ${bays === 1 ? "bay" : "bays"})` : ""}${going ? `, ${going} going up` : ""}${rebuilding ? `, ${rebuilding} being rebuilt` : ""}`);
  if (pits || granaries) { const days = Math.round(food / Math.max(1, b.appetite)); const what = [pits ? `${pits} storage ${pits === 1 ? "pit" : "pits"}` : "", granaries ? `${granaries} ${granaries === 1 ? "granary" : "granaries"}` : ""].filter(Boolean).join(" and "); parts.push(`${what} ${food < 1 ? "standing empty" : days < 1 ? "with a little food put by" : `holding ${days} ${days === 1 ? "day" : "days"} of food`}`); }
  for (const [name, o] of others) parts.push(`${o.up ? `${o.up === 1 ? `a ${name}` : `${o.up} ${name}s`}` : ""}${o.up && o.going ? ", " : ""}${o.going ? `${o.going === 1 ? `a ${name}` : `${o.going} ${name}s`} going up` : ""}`);
  if (ruins) parts.push(`${ruins} fallen-in ${ruins === 1 ? "hut" : "huts"}`);
  return parts.join("; ");
}
/** How long the band has been at this camp, and what keeps it there. */
function stayLine(s: Society, b: Band): string {
  if (b.moving) return "";
  const days = Math.floor((s.time - b.movedAt) / 60);
  return `Camped here ${days < 2 ? "since yesterday" : days < 40 ? `for ${days} days` : `since ${seasonYear(b.movedAt)}`}.`;
}

export function villageDetail(s: Society, id: number): VillageDetail | null {
  const v = s.villages.find(o => o.id === id); if (!v) return null;
  const bands = v.bands.map(bid => s.bandById.get(bid)).filter((b): b is Band => !!b);
  const founder = s.byId.get(v.founder);
  let huts = 0, building = 0, ruins = 0, pits = 0, food = 0, weirs = 0;
  const fields = new Map<string, { n: number; tame: number }>();
  for (const w of worksAround(s, v.x, v.y, 18)) {
    if (w.kind === Work.Hut) { if ((w.prog ?? 1) < 1) building++; else if (w.state < 0.2) ruins++; else huts++; }
    else if (w.kind === Work.Pit) { pits++; food += pitFood(w); }
    else if (w.kind === Work.Weir && w.state > 0.2) weirs++;
    else if (w.kind === Work.Plot) { const f = fields.get(w.crop) ?? { n: 0, tame: 0 }; f.n++; f.tame = Math.max(f.tame, w.tame ?? 0); fields.set(w.crop, f); }
  }
  /* whom most of the village's grown-ups listen to, whichever band they belong to */
  const count = new Map<number, number>();
  for (const b of bands) for (const mid of b.members) { const q = s.byId.get(mid); if (q && s.age(q) >= 16 && q.follows && q.follows !== q.id) count.set(q.follows, (count.get(q.follows) ?? 0) + 1); }
  const top = [...count].sort((a, c) => c[1] - a[1] || a[0] - c[0])[0];
  const appetite = bands.reduce((n, b) => n + b.appetite, 0);
  return {
    id: v.id, name: v.name, gloss: v.gloss, why: v.why, story: v.story, people: s.cultures[v.culture].lang.name,
    founded: v.founded, founder: { id: v.founder, name: v.founderName, alive: !!founder },
    bands: bands.map(b => { const l = s.byId.get(b.respected); return { id: b.id, name: b.name, pop: b.members.length, color: b.color, leader: l ? { id: l.id, name: l.name } : null }; }),
    listened: top && s.byId.get(top[0]) ? { id: top[0], name: s.byId.get(top[0])!.name, n: top[1] } : null,
    pop: v.pop, peak: v.peak, huts, building, ruins, pits, pitDays: appetite ? food / appetite : 0,
    fields: [...fields].map(([crop, f]) => ({ crop, n: f.n, tame: f.tame })), weirs,
    empty: v.empty, abandoned: v.abandoned,
    events: s.events.filter(e => Math.hypot(e.x - v.x, e.y - v.y) < 18 && (e.t >= v.founded - DAY_SECONDS * DAYS_PER_YEAR || e.kind === "hut")).slice(-8).reverse(),
    x: v.x, y: v.y,
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
    followers: b.followers, ledDays: (s.time - b.ledSince) / 60,
    contender: s.byId.get(b.contender) ? { id: b.contender, name: s.byId.get(b.contender)!.name, followers: followersOf(s, s.byId.get(b.contender)!) } : null,
    hearths: [...b.hearths.keys()].map(head => { const folk = household(s, b, head); const h = b.hearths.get(head)!; return { id: head, name: s.byId.get(head)?.name ?? "", people: folk.length, days: folk.length ? storeFood(h) / appetiteOf(s, folk) : 0 }; }).filter(h => h.people > 0 && h.name).sort((a, c) => c.days - a.days),
    pot: storeFood(b.store) / Math.max(1, b.appetite),
    sharedYesterday: b.yesterday.plant + b.yesterday.meat + b.yesterday.fish > 0 ? b.yesterday.shared / (b.yesterday.plant + b.yesterday.meat + b.yesterday.fish) : 0,
    feuds: s.feuds.filter(f => f.heat >= 0.1 && (s.byId.get(f.a)?.band === b.id || s.byId.get(f.b)?.band === b.id)).map(f => ({ a: { id: f.a, name: s.byId.get(f.a)?.name ?? "" }, b: { id: f.b, name: s.byId.get(f.b)?.name ?? "" }, heat: f.heat, cause: f.cause, days: (s.time - f.since) / 60 }) as BandFeud),
    store: { plant: Math.round(b.store.plant), meat: Math.round(b.store.meat), fish: Math.round(b.store.fish), dried: Math.round(b.store.dried), wood: Math.round(b.store.wood), hides: Math.round(b.store.hides) },
    dried: Math.round(b.store.dried + [...b.hearths.values()].reduce((a, h) => a + h.dried, 0)),
    ideas: IDEAS.filter(d => b.can[d.id] > 0 || !d.start && ms.some(q => q.know[d.id] > 0)).map(d => {
      const who = ms.filter(q => q.know[d.id] > 0).sort((a, c) => c.know[d.id] - a.know[d.id]);
      return { id: d.id, name: d.name, start: d.start, n: who.length, who: who.slice(0, 3).map(q => ({ id: q.id, name: q.name })) };
    }),
    works: worksAround(s, b.x, b.y, 18).filter(w => (w.kind === Work.Weir || w.kind === Work.Plot) && (w.band === b.id || !s.bandById.has(w.band))).map(w => ({ kind: w.kind === Work.Weir ? "weir" as const : "plot" as const, text: workText(s, b.id, w), x: w.x, y: w.y })),
    homes: homesLine(s, b), stay: stayLine(s, b), needs: needsLine(b), village: villageOf(s, b)?.name ?? "",
    days: campFood(b) / Math.max(1, b.appetite), fire: b.fire, moves: b.moves, camp: b.siteName,
    yesterday: { brought: Math.round(b.yesterday.plant + b.yesterday.meat + b.yesterday.fish), eaten: Math.round(b.yesterday.eaten) },
    shelter: cult.shelter, sharing: cult.sharing, cousins: cult.cousins,
    sample: [cult.lang.name, ...ms.slice(0, 5).map(q => q.name)],
    members: ms.sort((a, c) => s.age(c) - s.age(a)).map(q => ({ id: q.id, name: q.name, age: Math.floor(s.age(q)), sex: q.sex, look: s.look_(q) })),
    events: s.events.filter(e => e.band === b.id).slice(-6).reverse(),
    x: b.x, y: b.y, moving: !!b.moving,
  };
}
