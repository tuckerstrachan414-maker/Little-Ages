import { Place, type Person } from "./person.ts";

/*
  A band: the people who share a fire. It has a camp, a store everyone brings food to, and
  a fire someone has to keep fed. Households (a couple and their children, or a single
  adult) each raise a shelter around the fire. Nobody runs a band: whether it stays,
  moves or splits comes from what its members want and who they listen to.
*/

export interface Store { plant: number; meat: number; fish: number; wood: number; hides: number; }
export interface Band {
  id: number; name: string; culture: number; color: string;
  /** the fire, center of camp */
  x: number; y: number;
  fire: number;
  store: Store;
  members: number[];
  founded: number; movedAt: number; moves: number;
  /** household head id to shelter position */
  homes: Map<number, [number, number]>;
  /** how many members are on each goal right now */
  busy: Map<number, number>;
  /** the adult others listen to most */
  respected: number;
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
  today: { plant: number; meat: number; fish: number; eaten: number };
  yesterday: { plant: number; meat: number; fish: number; eaten: number };
}

export const storeFood = (s: Store) => s.plant + s.meat + s.fish;
/** Days the band could eat from its store. */
export const storeDays = (b: Band) => storeFood(b.store) / Math.max(1, b.appetite);

/** A person's guess at what a place holds now, from when they last heard about it. */
export function estimate(pl: { k: number; q: number; t: number }, now: number): number {
  const days = (now - pl.t) / 60;
  if (pl.k === Place.Game) return days > 3 ? 0 : pl.q * (1 - days / 3);
  if (pl.k === Place.Carcass) return days > 6 ? 0 : pl.q * (1 - days / 8);
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
