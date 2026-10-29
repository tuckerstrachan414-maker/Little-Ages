import { Place, type Person } from "./person.ts";
import { newProblems } from "../tech/problems.ts";

/*
  A band: the people who share a fire. It has a camp, a fire someone has to keep fed, and
  food in two kinds of place: the band's pot, which anyone may eat from, and each
  household's own hearth. Households (a couple and their children, or a single adult)
  each raise a shelter around the fire. How much of what someone brings in goes into the
  pot and how much stays at their own hearth is up to them, and their people's custom.
  Nobody runs a band: whether it stays, moves or splits comes from what its members want
  and who they listen to.
*/

/** Food by kind: fresh meat and fish spoil in days, plant food in weeks, meat and fish dried on racks keep for months. */
export interface Foods { plant: number; meat: number; fish: number; dried: number; }
export interface Store extends Foods { wood: number; hides: number; }
/** The food a household keeps back for itself, at its own hearth. */
export type Hearth = Foods;
export const noFood = (): Foods => ({ plant: 0, meat: 0, fish: 0, dried: 0 });
export interface Band {
  id: number; name: string; culture: number; color: string;
  /** the fire, center of camp */
  x: number; y: number;
  fire: number;
  members: number[];
  founded: number; movedAt: number; moves: number;
  /** household head id to where it lives: a shelter's position, or its hut's (with the hut's id, 0 for a shelter) */
  homes: Map<number, [number, number, number]>;
  /** how many members are on each goal right now */
  busy: Map<number, number>;
  /** the band's pot: food anyone may eat */
  store: Store;
  /** household head id to the food that household keeps at its own hearth */
  hearths: Map<number, Hearth>;
  /** the adult most of the others listen to (0 while nobody has a following) */
  respected: number;
  /** how many adults listen to them, and since when they have led */
  followers: number; ledSince: number;
  /** someone else with a following of their own, nearly as big: a second voice */
  contender: number;
  parent: number;
  /** bands they have met */
  met: Set<number>;
  /** food eaten per day by the whole band */
  appetite: number;
  /** a move under way: where to, who proposed it, since when */
  moving: { x: number; y: number; by: number; since: number; name: string; route: number[] | null } | null;
  siteName: string;
  /** where the camp gets its water */
  water: [number, number];
  /** where the band has camped lately, newest last */
  past: [number, number][];
  /** food brought in and eaten today, and yesterday's totals (for the band card and for tuning) */
  today: Day;
  yesterday: Day;
  /** how many of the band know each idea, and the one who knows it best (counted each morning) */
  can: Int32Array;
  keeper: Int32Array;
  /** when the fire last went out */
  outAt: number;
  /** food put by in the band's storage pits at this camp (counted again each day and whenever a pit is filled or emptied) */
  pit: number;
  /** the band's pile of materials at camp, by Mat: clay, flint, stone and the rest, carried in and not yet used */
  goods: Float32Array;
  /** when pots last broke at the fire (0 if never) */
  broke: number;
  /** each household's own things, by Mat: its pots, wool, herbs */
  hgoods: Map<number, Float32Array>;
  /** the band's own seed for each crop it sows: how tame the line has grown, from 0 (wild) up */
  seed: Record<string, number>;
  /** what the band is short of, 0..1 by Problem, worked out each morning (see tech/problems.ts) */
  problems: Float32Array;
  /** when meat or fish last came into camp */
  meatAt: number;
  /** when the wood coming back around this camp was last told */
  regrownAt: number;
}
export { newProblems };
/** Food brought in, how much of it went into the pot, what was eaten, what passed between hearths, and fresh meat and fish lost to rot. */
export interface Day { plant: number; meat: number; fish: number; eaten: number; shared: number; given: number; spoiled: number; }
export const newDay = (): Day => ({ plant: 0, meat: 0, fish: 0, eaten: 0, shared: 0, given: 0, spoiled: 0 });

export const storeFood = (s: Foods) => s.plant + s.meat + s.fish + s.dried;
/** All the food at the hearths of a band. */
export function hearthFood(b: Band): number { let v = 0; for (const h of b.hearths.values()) v += storeFood(h); return v; }
/** All the food in camp: the pot, every hearth, and the storage pits. */
export const campFood = (b: Band) => storeFood(b.store) + hearthFood(b) + b.pit;
/** Days the band could eat from all the food in camp. */
export const storeDays = (b: Band) => campFood(b) / Math.max(1, b.appetite);
/** Days the band could eat from what keeps: plant food and dried meat and fish, in the pot, at the hearths and in the pits (fresh meat and fish rot in days and are no store). */
export function keepingDays(b: Band): number {
  let v = b.store.plant + b.store.dried;
  for (const h of b.hearths.values()) v += h.plant + h.dried;
  return (v + b.pit) / Math.max(1, b.appetite);
}

/** A person's guess at what a place holds now, from when they last heard about it. */
export function estimate(pl: { k: number; q: number; t: number }, now: number): number {
  const days = (now - pl.t) / 60;
  if (pl.k === Place.Game) return days > 3 ? 0 : pl.q * (1 - days / 3);
  if (pl.k === Place.Carcass) return days > 6 ? 0 : pl.q * (1 - days / 8);
  /* a deposit is worth going back to for as long as anything is left in it */
  if (pl.k === Place.Deposit) return 2 + pl.q * 6;
  /* plant food and fish grow back, so an old report of a picked-over patch looks better with time */
  return Math.min(pl.q + days * 0.4, Math.max(pl.q, 6));
}

/**
  How good a camp at (x, y) would be, judged only from what this person knows: the food,
  fish and game they know of within a day's walk, weighed by how far it is.
*/
export function siteValue(p: Person, x: number, y: number, now: number): number {
  let v = 0;
  for (const pl of p.places) {
    if (pl.k !== Place.Plants && pl.k !== Place.Fish && pl.k !== Place.Game && pl.k !== Place.Rabbits) continue;
    const d = Math.hypot(pl.x - x, pl.y - y); if (d > 22) continue;
    const e = pl.k === Place.Game ? Math.min(12, pl.q * 1.5) * (1 - Math.min(1, (now - pl.t) / 600)) : estimate(pl, now);
    v += e * (1 - d / 22);
  }
  return v;
}

/** The household a person sleeps in: their mother's while young, their couple's once paired. */
export function homeOf(p: Person, byId: Map<number, Person>, now: number, depth = 0): number {
  if (depth > 4) return p.id;
  const age = (now - p.born) / 2400;
  if (age < 16 && !p.partner) {
    const m = byId.get(p.mother); if (m && m.band === p.band) return homeOf(m, byId, now, depth + 1);
    const g = byId.get(p.guardian); if (g && g.band === p.band) return homeOf(g, byId, now, depth + 1);
    const f = byId.get(p.father); if (f && f.band === p.band) return homeOf(f, byId, now, depth + 1);
  }
  const q = byId.get(p.partner);
  if (q && q.band === p.band) return p.sex === "f" ? p.id : q.sex === "f" ? q.id : Math.min(p.id, q.id);
  return p.id;
}
