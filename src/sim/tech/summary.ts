import { Known, type TechDefLite, type TechGroup, type TechGroupInfo, type TechPanelData, type TechNodeDetail } from "../../shared/tech.ts";
import { TECHS, TECH_COUNT, eraOf } from "./tree.ts";
import { Problem, type ProblemKey } from "./problems.ts";
import { ready } from "../people/ideas.ts";
import type { Band } from "../people/band.ts";
import type { Society } from "../people/society.ts";

/*
  What the panel is told: the tree itself, once; and for whichever group is being looked
  at (the whole world, one people, one settlement), how each node stands for them: known,
  within reach, known once and lost, or not yet thought of.
*/

export function techTree(): TechDefLite[] {
  return TECHS.map(d => ({ id: d.id, key: d.key, name: d.name, how: d.how, branch: d.branch, era: d.era, needs: d.needs, any: d.any, active: d.active, start: d.start, icon: d.icon }));
}

/** The color a people goes by: that of its first band. */
export function peopleColor(s: Society, culture: number): string {
  const b = s.bands.filter(o => o.culture === culture).sort((a, c) => a.id - c.id)[0];
  return b?.color ?? "#9a8a6a";
}

/** The bands whose knowledge a group is made of. */
export function groupBands(s: Society, g: TechGroup): Band[] {
  if (g.kind === "world") return s.bands;
  if (g.kind === "people") return s.bands.filter(b => b.culture === g.id);
  const v = s.villages.find(o => o.id === g.id);
  return v ? v.bands.map(id => s.bandById.get(id)).filter((b): b is Band => !!b) : [];
}

function groupInfo(s: Society, g: TechGroup, known: (id: number) => boolean): TechGroupInfo {
  if (g.kind === "world") return { ...g, name: "The whole world", color: "#2b2418", age: eraOf(known) };
  if (g.kind === "people") return { ...g, name: `The ${s.cultures[g.id]?.lang.name ?? "?"}`, color: peopleColor(s, g.id), age: eraOf(known) };
  const v = s.villages.find(o => o.id === g.id);
  return { ...g, name: v?.name ?? "?", color: v ? peopleColor(s, v.culture) : "#9a8a6a", age: eraOf(known) };
}

/** Every group there is to look at: the world, each people with anyone alive, each village lived in. */
export function techGroups(s: Society): TechGroupInfo[] {
  const out: TechGroupInfo[] = [groupInfo(s, { kind: "world", id: 0 }, id => s.ideas[id].knowers > 0)];
  for (const c of s.cultures) {
    const bs = s.bands.filter(b => b.culture === c.id); if (!bs.length) continue;
    out.push(groupInfo(s, { kind: "people", id: c.id }, id => bs.some(b => b.can[id] > 0)));
  }
  for (const v of s.villages) {
    if (v.abandoned || !v.bands.length) continue;
    const bs = groupBands(s, { kind: "settlement", id: v.id });
    out.push(groupInfo(s, { kind: "settlement", id: v.id }, id => bs.some(b => b.can[id] > 0)));
  }
  return out;
}

export function techPanel(s: Society, g: TechGroup): TechPanelData {
  const bs = groupBands(s, g);
  const knowers = new Uint16Array(TECH_COUNT), nodes = new Uint8Array(TECH_COUNT), refine = new Float32Array(TECH_COUNT), firstT = new Float32Array(TECH_COUNT);
  for (const b of bs) for (let i = 0; i < TECH_COUNT; i++) knowers[i] += b.can[i];
  const known = (id: number) => knowers[id] > 0;
  const cultures = new Set(bs.map(b => b.culture));
  for (const d of TECHS) {
    const log = s.ideas[d.id];
    if (known(d.id)) nodes[d.id] = Known.Known;
    else if (g.kind === "world" ? !!log.first : [...cultures].some(c => log.cultures.has(c))) nodes[d.id] = Known.Lost;
    else if (d.active && d.needs.every(known) && (!d.any.length || d.any.some(known))) nodes[d.id] = Known.Reach;
    if (log.first && (g.kind === "world" || cultures.has(s.bandById.get(log.first.band)?.culture ?? -1))) firstT[d.id] = log.first.t;
    if (s.refine) { let r = 0; for (const c of cultures) r = Math.max(r, s.refine.get(c)?.[d.id] ?? 0); refine[d.id] = r; }
  }
  const data: TechPanelData = { group: groupInfo(s, g, known), groups: techGroups(s), nodes, knowers, refine, firstT };
  if (g.kind === "world") {
    const colors: string[][] = TECHS.map(() => []);
    for (const c of s.cultures) { const col = peopleColor(s, c.id), mine = s.bands.filter(b => b.culture === c.id); if (!mine.length) continue; for (const d of TECHS) if (!d.start && mine.some(b => b.can[d.id] > 0)) colors[d.id].push(col); }
    data.colors = colors;
  }
  return data;
}

const PROBLEM_ANSWERS: Record<ProblemKey, string> = {
  Hunger: "hunger", Spoilage: "food going bad", Cold: "the cold", Wet: "the wet", Water: "water far from camp", Storage: "food that will not keep", Wood: "firewood running short", Crowding: "a crowded camp",
  Carry: "more than can be carried", Illness: "sickness", Far: "food far from camp", Fire: "a dead fire", Meat: "no meat", HerdLoss: "animals lost", Dry: "dry ground", Clay: "clay at hand", Stone: "stone at hand", Flint: "flint at hand",
};

export function techNode(s: Society, id: number, g: TechGroup): TechNodeDetail | null {
  const d = TECHS[id]; if (!d) return null;
  const bs = groupBands(s, g), log = s.ideas[id];
  const known = (i: number) => bs.some(b => b.can[i] > 0);
  const people: { q: { id: number; name: string; know: Float32Array }; band: string }[] = [];
  for (const b of bs) for (const mid of b.members) { const q = s.byId.get(mid); if (q && q.know[id] > 0) people.push({ q, band: b.name }); }
  people.sort((a, c) => c.q.know[id] - a.q.know[id]);
  const cultures = new Set(bs.map(b => b.culture));
  let firstHere: TechNodeDetail["firstHere"] = null;
  if (log.first && cultures.has(s.bandById.get(log.first.band)?.culture ?? -1)) firstHere = { who: log.first.who, name: log.first.name, bandName: log.first.bandName, t: log.first.t, x: log.first.x, y: log.first.y };
  const n = people.length, nb = bs.filter(b => b.can[id] > 0).length;
  let status: string;
  if (d.start) status = `An old way, known from the start: ${n} ${n === 1 ? "person knows" : "people know"} it here, in ${nb} ${nb === 1 ? "band" : "bands"}.`;
  else if (n) status = `${n} ${n === 1 ? "person knows" : "people know"} it here, in ${nb} ${nb === 1 ? "band" : "bands"}.`;
  else if (!d.active) status = "Nobody has thought of it; it lies beyond what this age can reach.";
  else if (log.first) status = g.kind === "world" ? `Lost: nobody alive knows it.` : [...cultures].some(c => log.cultures.has(c)) ? "Known here once, and lost." : "Known elsewhere, not here.";
  else if (d.needs.every(known) && (!d.any.length || d.any.some(known))) status = "Within reach: everything it builds on is known here. Nobody has worked it out yet.";
  else status = "Nobody has worked it out yet.";
  /* someone with a weak grasp of a thing is still learning it; a master teaches faster */
  const best = people[0];
  return {
    id, key: d.key, name: d.name, how: d.how, branch: d.branch, era: d.era, active: d.active, start: d.start, icon: d.icon, status,
    needs: d.needs.map(i => ({ id: i, name: TECHS[i].name, known: known(i) })), any: d.any.map(i => ({ id: i, name: TECHS[i].name, known: known(i) })),
    unlocks: TECHS.filter(o => o.needs.includes(id) || o.any.includes(id)).map(o => ({ id: o.id, name: o.name, known: known(o.id) })),
    first: log.first ? { who: log.first.who, name: log.first.name, bandName: log.first.bandName, people: log.first.people, t: log.first.t, x: log.first.x, y: log.first.y } : null,
    firstHere, times: log.times, lostAt: log.lostAt,
    knowers: people.slice(0, 6).map(({ q, band }) => ({ id: q.id, name: q.name, band, m: q.know[id] })), nKnowers: n, bands: nb,
    refine: s.refine && cultures.size ? { level: Math.max(...[...cultures].map(c => s.refine!.get(c)?.[id] ?? 0)), uses: Math.max(...[...cultures].map(c => s.uses?.get(c)?.[id] ?? 0)), best: best ? { id: best.q.id, name: best.q.name } : null } : null,
    answers: d.problems ? (Object.keys(d.problems) as ProblemKey[]).filter(k => Problem[k] < Problem.Clay).map(k => PROBLEM_ANSWERS[k]) : [],
  };
}
/** Whether a person is ready for a node, for the cards. */
export { ready };
