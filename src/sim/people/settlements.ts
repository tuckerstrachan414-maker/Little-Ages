import { DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Goal, YEAR, type Person } from "./person.ts";
import type { Band } from "./band.ts";
import { Work, worksAround } from "./works.ts";
import { hutStands } from "./homes.ts";
import { standing, startBuilding, OWNER } from "../buildings/build.ts";
import { DEFS, Line, defById } from "./../buildings/defs.ts";
import { communalSite, materialsInReach } from "../buildings/wants.ts";
import { knows } from "./ideas.ts";
import { TECHS, techIx, ERA_NAMES } from "../tech/tree.ts";
import { Problem, PROBLEM_COUNT } from "../tech/problems.ts";
import { VILLAGE_R, type Village } from "./villages.ts";
import type { Society } from "./society.ts";

/*
  Settlements: what a village is becoming, and who it listens to. A hamlet is a few huts
  that have stood a year; a village has thirty people or eight houses; a town has a hundred,
  a well or a granary the whole place shares, and a craft; a city waits for walls and a
  temple. The one most of a village's grown-ups go along with, across its bands, is its
  chief: not a ruler (nobody is compelled yet) but the one who can set the village to a
  work it feels the need of, a well where the water is far or a granary where the pits
  overflow, and whom its people join or ignore as they think of them. A people's age is
  what enough of them know and do.
*/

export const TIER_NAMES = ["hamlet", "village", "town", "city"];
const WELLS = () => techIx("wells"), GRANARY = () => techIx("granary");

export function settlementsDay(s: Society): void {
  for (const v of s.villages) {
    if (v.abandoned || !v.bands.length) { if (v.chief) { v.chief = 0; s.villagesVersion++; } v.call = null; continue; }
    tierDay(s, v);
    chooseChief(s, v);
    chiefDay(s, v);
  }
  agesDay(s);
}

/** The bands living in a village now. */
export const villageBands = (s: Society, v: Village): Band[] => v.bands.map(id => s.bandById.get(id)).filter((b): b is Band => !!b);
/** The grown-ups of a village, across its bands. */
export function villageAdults(s: Society, v: Village): Person[] {
  const out: Person[] = [];
  for (const b of villageBands(s, v)) for (const id of b.members) { const q = s.byId.get(id); if (q && s.age(q) >= 16) out.push(q); }
  return out;
}
/** What stands at a village: houses, the buildings its bands or the village share, crafts. */
export function villageBuildings(s: Society, v: Village): { houses: number; communal: Work[]; crafts: number } {
  let houses = 0, crafts = 0; const communal: Work[] = [];
  for (const w of worksAround(s, v.x, v.y, VILLAGE_R + 2)) {
    if (w.kind === Work.Hut && hutStands(w)) houses++;
    else if (w.kind >= 4 && standing(w)) { if ((w.owner ?? 0) >= 1) communal.push(w); if (w.kind === Line.Kiln) crafts++; }
    else if (w.kind === Work.Pit && (w.tier ?? 0) >= 1 && (w.owner ?? 0) >= 1 && standing(w)) communal.push(w);
  }
  return { houses, communal, crafts };
}

function tierDay(s: Society, v: Village): void {
  const { houses, communal, crafts } = villageBuildings(s, v);
  v.communal = communal.map(w => w.id);
  let tier = 0;
  if (v.pop >= 30 || houses >= 8) tier = 1;
  if (tier === 1 && v.pop >= 100 && communal.length >= 2 && crafts >= 1) tier = 2;
  /* a city waits for walls and a temple (a later checkpoint) */
  if (tier === v.tier) return;
  const up = tier > v.tier, was = v.tier; v.tier = tier; s.villagesVersion++;
  if (up) {
    const what = [communal.filter(w => w.kind === Line.Well).length ? "a well" : "", communal.filter(w => w.kind === Line.Store).length ? "a granary the whole place shares" : "", crafts ? `${crafts === 1 ? "a kiln" : `${crafts} kilns`}` : ""].filter(Boolean);
    s.event("tier", Bubble.Home, tier === 1 ? `${v.name} has grown into a village: ${v.pop} people in ${houses} houses.` : `${v.name} has grown into a town: ${v.pop} people, ${houses} houses${what.length ? `, ${what.join(", ")}` : ""}.`, v.x, v.y, [v.chief].filter(id => s.byId.has(id)), v.bands[0], tier);
  } else if (was >= 1) s.event("tier", Bubble.Sad, `${v.name} has dwindled to a ${TIER_NAMES[tier]}: ${v.pop} people are left there.`, v.x, v.y, [], v.bands[0], 0);
}

/** Whom the grown-ups of a village listen to, across its bands: the top following and the next. */
export function listenedAt(s: Society, v: Village): { id: number; n: number }[] {
  const count = new Map<number, number>();
  for (const q of villageAdults(s, v)) if (q.follows && q.follows !== q.id && s.byId.has(q.follows)) count.set(q.follows, (count.get(q.follows) ?? 0) + 1);
  return [...count].map(([id, n]) => ({ id, n })).sort((a, c) => c.n - a.n || a.id - c.id);
}
function chooseChief(s: Society, v: Village): void {
  const adults = villageAdults(s, v), ranked = listenedAt(s, v);
  const cur = v.chief && s.byId.get(v.chief) && v.bands.includes(s.byId.get(v.chief)!.band) ? v.chief : 0;
  const curN = cur ? ranked.find(r => r.id === cur)?.n ?? 0 : 0;
  const top = ranked[0], next = ranked[1]?.n ?? 0;
  const had = v.chief;
  const settled = s.time - v.chiefSince > DAY_SECONDS * 10;
  /* a chief has the ear of a good share of the village, and clearly more than anyone else; one is replaced only by someone with a clearly bigger following */
  const qualifies = !!top && top.n >= Math.max(3, adults.length * 0.35) && top.n >= next * 1.5;
  if (!cur) v.chief = qualifies ? top!.id : 0;
  else if (curN < Math.max(2, adults.length * 0.2)) v.chief = qualifies && top!.id !== cur ? top!.id : 0;
  else if (qualifies && top!.id !== cur && top!.n >= curN + Math.max(2, Math.ceil(curN * 0.3)) && settled) v.chief = top!.id;
  if (v.chief !== had) {
    v.chiefSince = s.time; s.villagesVersion++;
    const c = s.byId.get(v.chief);
    if (c) {
      const n = ranked.find(r => r.id === c.id)?.n ?? 0, old = s.byId.get(had);
      s.event("chief", Bubble.Star, `${c.name} of the ${s.band(c).name} has become the one most at ${v.name} listen to: ${n} of its ${adults.length} grown-ups go along with ${c.sex === "f" ? "her" : "his"} word${old && old !== c ? `, where they listened to ${old.name} before` : ""}.`, v.x, v.y, [c.id], c.band, had ? 1 : 0);
      c.prestige += 0.2;
    }
  }
}

/** The village's wants, as the mean of its bands' weighed by their people. */
export function villageProblems(s: Society, v: Village): Float32Array {
  const out = new Float32Array(PROBLEM_COUNT); let pop = 0;
  for (const b of villageBands(s, v)) { for (let k = 0; k < PROBLEM_COUNT; k++) out[k] += b.problems[k] * b.members.length; pop += b.members.length; }
  if (pop) for (let k = 0; k < PROBLEM_COUNT; k++) out[k] /= pop;
  return out;
}
/** The chief sets the village to a work it feels the need of: a well where the water is far, a granary where the pits overflow. */
function chiefDay(s: Society, v: Village): void {
  /* a call stands while the work is going up; one nobody has answered in two years is given up, the marked-out frame with it */
  if (v.call) {
    const w = s.works.find(o => o.id === v.call!.work);
    const given = !!w && (w.prog ?? 0) <= 0 && s.time - v.call.since > YEAR * 2;
    if (given) { s.works = s.works.filter(o => o !== w); s.worksVersion++; }
    if (!w || standing(w) || given) v.call = null; else return;
  }
  const chief = s.byId.get(v.chief); if (!chief || !v.bands.includes(chief.band)) return;
  const b = s.band(chief), pr = villageProblems(s, v), adults = villageAdults(s, v);
  if (adults.length < 6) return;
  const { communal } = villageBuildings(s, v);
  const her = chief.sex === "f" ? "her" : "his";
  if (pr[Problem.Water] > 0.5 && !communal.some(w => w.kind === Line.Well) && !worksAround(s, v.x, v.y, 14).some(w => w.kind === Line.Well && (w.prog ?? 1) < 1)) {
    const def = defById("well0");
    if (adults.some(q => knows(q, WELLS())) && materialsInReach(s, b, def)) {
      const at = communalSite(s, b, def, v.id);
      if (at) {
        const w = startBuilding(s, chief, def, at[0], at[1], "settlement", 0);
        v.call = { work: w.id, since: s.time };
        s.event("communal", Bubble.Drop, `${chief.name}, whom most at ${v.name} listen to, has set the village to digging a well: the river is a long walk, and the children go thirsty. ${her === "her" ? "She" : "He"} marked out the spot ${Math.round(Math.hypot(at[0] - v.x, at[1] - v.y))} paces from the fires.`, at[0], at[1], [chief.id], b.id, 0);
        return;
      }
    }
  }
  /* more food put by than three households' pits can hold, and granaries known */
  const overflowing = villageBands(s, v).reduce((n, o) => n + (o.problems[Problem.Storage] > 0.5 ? Math.max(1, o.hearths.size) : 0), 0);
  if (overflowing >= 3 && !communal.some(w => w.kind === Line.Store) && !worksAround(s, v.x, v.y, 14).some(w => w.kind === Line.Store && (w.owner ?? 0) >= 1 && (w.prog ?? 1) < 1)) {
    const def = defById("store1");
    if (adults.some(q => knows(q, GRANARY())) && materialsInReach(s, b, def)) {
      const at = communalSite(s, b, def, v.id + 7);
      if (at) {
        const w = startBuilding(s, chief, def, at[0], at[1], "settlement", 0);
        v.call = { work: w.id, since: s.time };
        s.event("communal", Bubble.Home, `${chief.name}, whom most at ${v.name} listen to, has set the village to raising a granary for everyone: the pits are full and the mice get at what is left over.`, at[0], at[1], [chief.id], b.id, 1);
      }
    }
  }
}

/** A people's age: the highest era of what three or more of them know (or a quarter of their grown-ups), told when it changes. */
export function cultureAge(s: Society, culture: number): number {
  const bands = s.bands.filter(b => b.culture === culture); if (!bands.length) return 0;
  let adults = 0; for (const b of bands) for (const id of b.members) { const q = s.byId.get(id); if (q && s.age(q) >= 16) adults++; }
  const need = Math.min(3, Math.max(1, Math.ceil(adults * 0.25)));
  let era = 0;
  for (const d of TECHS) {
    if (d.start || d.era <= era) continue;
    let n = 0; for (const b of bands) n += b.can[d.id];
    if (n >= need) era = d.era;
  }
  return era;
}
function agesDay(s: Society): void {
  for (const c of s.cultures) {
    const era = cultureAge(s, c.id);
    if (era === c.age) continue;
    const up = era > c.age, bands = s.bands.filter(b => b.culture === c.id), big = bands.slice().sort((a, b) => b.members.length - a.members.length)[0];
    if (!big) { c.age = era; continue; }
    const first = up && !s.cultures.some(o => o !== c && o.age >= era);
    c.age = era;
    s.event("age", Bubble.Star, up ? `The ${c.lang.name} have entered the ${ERA_NAMES[era]}${first ? ", the first people anywhere to do so" : ""}: enough of them know its ways now.` : `The ${c.lang.name} have fallen back to the ${ERA_NAMES[era]}: too few are left who know the ways of the ${ERA_NAMES[era + 1]}.`, big.x, big.y, [big.respected].filter(id => s.byId.has(id)), big.id, first ? 1 : 0);
  }
}
/** Someone's standing in the village: its chief, or a band's leader (for the sprites). */
export const isChief = (s: Society, p: Person): boolean => s.villages.some(v => v.chief === p.id && !v.abandoned);
void Goal; void YEAR; void DEFS; void OWNER;
