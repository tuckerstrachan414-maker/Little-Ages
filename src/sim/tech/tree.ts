import type { Person } from "../people/person.ts";
import type { Society } from "../people/society.ts";
import { FOOD } from "./branches/food.ts";
import { ANIMALS } from "./branches/animals.ts";
import { TOOLS } from "./branches/tools.ts";
import { CRAFTS } from "./branches/crafts.ts";
import { BUILDING } from "./branches/building.ts";
import { WATER } from "./branches/water.ts";
import { TRANSPORT } from "./branches/transport.ts";
import { KNOWLEDGE } from "./branches/knowledge.ts";
import { HEALING } from "./branches/healing.ts";

/*
  The tree of everything people might ever work out, from keeping a fire to leaving the
  planet, as data. Nothing in it is a ladder to climb: a node only says what has to be known
  before it can come to anyone, during what kind of work it might, and what it is for. The
  nodes of later ages are listed so the whole shape can be seen, but only "active" nodes
  have the triggers and effects of this build; nobody can work the others out yet.
*/

export { Branch, BRANCH_NAMES, Era, ERA_NAMES, ERA_COUNT, BRANCH_COUNT } from "./defs.ts";
export type { Ctx, TechSrc, TechDef, IdeaDef } from "./defs.ts";
import { ERA_NAMES, type TechSrc, type TechDef, type Ctx } from "./defs.ts";

/** The old ways and first discoveries, in the order the game has always indexed them; they come first so nothing that was recorded by index changes. */
const LEGACY = ["keep-fire", "spear", "fishing", "hides", "snares", "make-fire", "blades", "axe", "digging-sticks", "baskets", "nets", "weirs", "drying", "planting", "pits", "huts"];

function load(): TechDef[] {
  const src = [...FOOD, ...ANIMALS, ...TOOLS, ...CRAFTS, ...BUILDING, ...WATER, ...TRANSPORT, ...KNOWLEDGE, ...HEALING];
  const byKey = new Map<string, TechSrc>();
  for (const n of src) { if (byKey.has(n.key)) throw new Error(`tech ${n.key} is listed twice`); byKey.set(n.key, n); }
  for (const k of LEGACY) if (!byKey.has(k)) throw new Error(`the old way ${k} is missing from the tree`);
  const ordered = [...LEGACY.map(k => byKey.get(k)!), ...src.filter(n => !LEGACY.includes(n.key))];
  const ix = new Map(ordered.map((n, i) => [n.key, i] as const));
  const out: TechDef[] = ordered.map((n, i) => {
    for (const k of [...n.needs, ...(n.any ?? [])]) if (!ix.has(k)) throw new Error(`tech ${n.key} builds on ${k}, which is not in the tree`);
    const active = n.active ?? false;
    return {
      key: n.key, id: i, name: n.name, how: n.how, title: n.title ?? "", branch: n.branch, era: n.era,
      needs: n.needs.map(k => ix.get(k)!), needKeys: n.needs.slice(), any: (n.any ?? []).map(k => ix.get(k)!), anyKeys: (n.any ?? []).slice(),
      during: (n.during ?? []).map(d => ({ step: d.step, rank: d.rank ?? 0 })), ctx: n.ctx, problems: n.problems, story: n.story, near: n.near,
      age: n.age ?? 12, child: n.child ?? 0.03, watch: n.watch ?? 0.006, show: n.show ?? 0.4, skill: n.skill ?? 3, worth: n.worth ?? 0.5,
      spark: active ? (n.spark ?? 0) : 0, start: n.start ?? false, anim: n.anim ?? 10, icon: n.icon ?? 16, place: n.place, active,
    };
  });
  return out;
}

export const TECHS: TechDef[] = load();
export const TECH_COUNT = TECHS.length;
const keyIndex = new Map(TECHS.map(d => [d.key, d.id] as const));
/** The index of a node by its key; throws for a key that is not in the tree. */
export function techIx(key: string): number { const i = keyIndex.get(key); if (i === undefined) throw new Error(`no tech ${key}`); return i; }
export const techByKey = (key: string): TechDef | undefined => { const i = keyIndex.get(key); return i === undefined ? undefined : TECHS[i]; };

/** The old names for the first sixteen, as every part of the game has always called them. */
export const Idea = {
  KeepFire: techIx("keep-fire"), Spear: techIx("spear"), Fishing: techIx("fishing"), Hides: techIx("hides"), Snares: techIx("snares"),
  MakeFire: techIx("make-fire"), Blades: techIx("blades"), Axe: techIx("axe"), Digging: techIx("digging-sticks"), Baskets: techIx("baskets"), Nets: techIx("nets"), Weirs: techIx("weirs"), Drying: techIx("drying"), Planting: techIx("planting"),
  Pits: techIx("pits"), Huts: techIx("huts"),
} as const;

/** Which nodes can come to mind during each kind of work, in the order they are weighed. */
export const DURING: Partial<Record<number, number[]>> = (() => {
  const m = new Map<number, { id: number; rank: number }[]>();
  for (const d of TECHS) for (const e of d.during) { let l = m.get(e.step); if (!l) { l = []; m.set(e.step, l); } l.push({ id: d.id, rank: e.rank }); }
  const out: Partial<Record<number, number[]>> = {};
  for (const [k, l] of m) out[k] = l.sort((a, b) => a.rank - b.rank || a.id - b.id).map(e => e.id);
  return out;
})();

/*
  Event hints carry a level and a node: a discovery first in the world (level 2) or first
  among a people (1), know-how crossing between peoples (1), know-how lost to the world (1).
*/
export const HINT_BASE = 4096;
export const packHint = (level: number, id: number): number => level * HINT_BASE + id;
export const unpackHint = (h: number): { level: number; id: number } => ({ level: Math.floor(h / HINT_BASE), id: h % HINT_BASE });

/** Checks the tree for mistakes: a need that comes later in history than what needs it, a loop, an active node with nothing to spark it. Returns the faults found. */
export function validateTree(): string[] {
  const faults: string[] = [];
  for (const d of TECHS) {
    for (const n of [...d.needs, ...d.any]) if (TECHS[n].era > d.era) faults.push(`${d.key} (${ERA_NAMES[d.era]}) builds on ${TECHS[n].key} (${ERA_NAMES[TECHS[n].era]}), which comes later`);
    if (d.active && !d.start && !d.during.length) faults.push(`${d.key} is active but nothing can bring it to mind`);
    if (d.active && !d.start && d.spark <= 0) faults.push(`${d.key} is active but can never be worked out (spark 0)`);
    if (!d.active && d.spark > 0) faults.push(`${d.key} is not active but has a spark`);
  }
  /* no loops: every node must be reachable in an order where its needs come first */
  const state = new Int8Array(TECH_COUNT);
  const visit = (i: number, trail: number[]): void => {
    if (state[i] === 2) return;
    if (state[i] === 1) { faults.push(`a loop of needs through ${[...trail, i].map(k => TECHS[k].key).join(" -> ")}`); return; }
    state[i] = 1; for (const n of [...TECHS[i].needs, ...TECHS[i].any]) visit(n, [...trail, i]); state[i] = 2;
  };
  for (let i = 0; i < TECH_COUNT; i++) visit(i, []);
  return faults;
}

/** The highest age any of a people's nodes belongs to, from what is known; used by the panel and the cards. */
export function eraOf(known: (id: number) => boolean): number {
  let era = 0;
  for (const d of TECHS) if (!d.start && d.era > era && known(d.id)) era = d.era;
  return era;
}

/** Hooks a node may have beyond its data: how much it is needed right now, and the story of its finding. */
export interface TechHooks {
  pressure?: (s: Society, p: Person, k: number, c: Ctx) => number;
  story?: (s: Society, p: Person, k: number, c: Ctx) => string;
}
