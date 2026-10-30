import { Biome, DAY_SECONDS, Flag } from "../../shared/types.ts";
import { Bubble, type HutLook } from "../../shared/people.ts";
import { Food, Place, Skill, type Person, type Step } from "./person.ts";
import { homeOf, storeFood, noFood, keepingDays, type Band, type Foods } from "./band.ts";
import { Work, addWork, worksAround, workById } from "./works.ts";
import { knows, practice } from "./ideas.ts";
import { Idea } from "../tech/tree.ts";
import { householdAppetite, hearthOf, pass, take } from "./sharing.ts";
import { decayOf, defOf } from "../buildings/build.ts";
import { houseWords } from "../buildings/defs.ts";
import type { Society } from "./society.ts";

/*
  Homes and stores: what households make once they mean to stay.

  A storage pit is dug by the shelter and lined with bark and grass. Plant food and dried
  meat put into it keep for months instead of weeks, and in a hard frost fresh meat keeps
  too; a family eats from its own pit when its hearth is bare. A pit cannot be carried:
  food in the ground is a reason to stay, or to come back.

  A hut is raised a little at a time, a bundle of poles fetched and lashed into the frame,
  then thatched, barked or turfed in each people's own way. It is warmer to sleep in than a
  shelter, keeps the hearth's food drier, and stands when the family is away: a household
  that comes back moves into its old hut and mends it, and huts nobody lives in fall in
  slowly until only their ribs are left. Where a people builds longhouses, grown children
  add a bay to their parents' house instead of raising their own.

  Pits and huts belong to the household that made them, and pass to its heirs as the
  household changes: a widow keeps the hut, newlyweds move into whichever of theirs stands,
  and a hut left with nobody is there for the next family without one.
*/

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* ---------------- pits ---------------- */

/** What a pit can hold. */
export const pitRoom = (w: Work) => w.size ?? 40;
export const pitFood = (w: Work) => (w.foods ? storeFood(w.foods) : 0);
/** A household's own pit at its band's camp. */
export function pitOf(s: Society, b: Band, home: number): Work | null {
  let shared: Work | null = null;
  for (const w of worksAround(s, b.x, b.y, 12)) {
    if (w.kind !== Work.Pit) continue;
    if (w.home === home && w.band === b.id) return w;
    /* a granary the band or the village shares, standing, is everyone's to put by in */
    if ((w.owner ?? 0) >= 1 && (w.prog ?? 1) >= 1 && w.state > 0.2 && w.foods && !shared) shared = w;
  }
  return shared;
}
/** Counts the food in a band's pits at its camp again (for the days of food the band has). */
export function recountPits(s: Society, b: Band): void {
  let v = 0;
  if (!b.moving) for (const w of worksAround(s, b.x, b.y, 12)) if (w.kind === Work.Pit && w.band === b.id) v += pitFood(w);
  b.pit = v;
}
/** Days of food a household has in its pit. */
export function pitDays(s: Society, b: Band, home: number): number {
  const w = pitOf(s, b, home);
  return w ? pitFood(w) / householdAppetite(s, b, home) : 0;
}
/** Whether it is freezing hard enough at camp for fresh meat to keep in the ground. */
export const freezing = (s: Society, b: Band) => s.tempC(b.x, b.y) < -2;

/** Moves food of the given kinds from one store to another, up to `amt`: returns what moved. */
function moveKinds(from: Foods, to: Foods, amt: number, kinds: (keyof Foods)[]): number {
  let left = amt;
  for (const k of kinds) { const t = Math.min(left, from[k]); from[k] -= t; to[k] += t; left -= t; if (left <= 1e-9) break; }
  return amt - left;
}
const KEEPING: (keyof Foods)[] = ["plant", "dried"], FROZEN: (keyof Foods)[] = ["meat", "fish", "plant", "dried"];

/** Somewhere to dig a household's pit: dry ground a step or two from its shelter, clear of everything else. */
export function pitSite(s: Society, b: Band, home: number): [number, number] | null {
  const h = b.homes.get(home); if (!h) return null;
  for (let k = 0; k < 8; k++) {
    const a = (k * 0.785 + home * 0.37) % (Math.PI * 2), x = h[0] + Math.cos(a) * 1.9, y = h[1] + 0.4 + Math.sin(a) * 1.2;
    if (clearAt(s, b, x, y, 0.9, home)) return [x, y];
  }
  return null;
}
/** A pit dug: how big depends on the digging stick. */
export function digPit(s: Society, p: Person, st: Step): void {
  const b = s.band(p), home = homeOf(p, s.byId, s.time);
  if (pitOf(s, b, home)) return;
  practice(s, p, Idea.Pits, 0.03);
  const first = !worksAround(s, b.x, b.y, 14).some(w => w.kind === Work.Pit && w.band === b.id);
  addWork(s, { kind: Work.Pit, x: st.x, y: st.y, wx: st.x, wy: st.y, band: b.id, home, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, size: knows(p, Idea.Digging) ? 52 : 40, foods: noFood(), opened: s.time });
  s.stats.homes.pits++; if (!s.stats.homes.firstPit) s.stats.homes.firstPit = s.time;
  p.prestige += 0.04;
  if (first) s.event("pit", Bubble.Home, `${p.name} of the ${b.name} dug a pit by ${p.sex === "f" ? "her" : "his"} family's shelter and lined it with bark and grass, to keep food through ${s.season >= 2 ? "the winter" : "the lean months"}. It is the band's first.`, st.x, st.y, [p.id], b.id);
}
/** Putting food by: what the household has beyond its needs goes from the hearth into the pit. */
export function storeInPit(s: Society, p: Person, st: Step): void {
  const b = s.band(p), w = workById(s, st.id); if (!w || w.kind !== Work.Pit || !w.foods) return;
  const head = homeOf(p, s.byId, s.time), h = hearthOf(s, p), app = householdAppetite(s, b, head);
  const keep = app * (s.season >= 2 ? 3 : 4);
  const kinds = freezing(s, b) ? FROZEN : KEEPING;
  const spare = Math.max(0, kinds.reduce((a, k) => a + h[k], 0) - keep);
  const moved = moveKinds(h, w.foods, Math.min(pitRoom(w) - pitFood(w), spare, 12), kinds);
  w.opened = s.time; b.pit += moved; s.stats.homes.stored += moved;
}
/** Opening the pit when the hearth is bare: a couple of days' food comes back to the hearth. */
export function fetchFromPit(s: Society, p: Person, st: Step): void {
  const b = s.band(p), w = workById(s, st.id); if (!w || w.kind !== Work.Pit || !w.foods) return;
  const head = homeOf(p, s.byId, s.time), got = pass(w.foods, hearthOf(s, p), householdAppetite(s, b, head) * 2);
  w.opened = s.time; b.pit = Math.max(0, b.pit - got); s.stats.homes.fetched += got;
}
/** Eating straight from the family's pit at this camp, when the hearth and the pot are bare. */
export function eatFromPit(s: Society, p: Person, b: Band, home: number, want: number, took?: Foods): number {
  if (Math.hypot(p.x - b.x, p.y - b.y) > 8) return 0;
  const w = pitOf(s, b, home); if (!w || !w.foods) return 0;
  const got = take(w.foods, want, took);
  if (got > 0) { w.opened = s.time; b.pit = Math.max(0, b.pit - got); s.stats.homes.eaten += got; }
  return got;
}

/** Each day: food in a pit keeps far longer than at the hearth; a pit nobody opens loses a little more to mice and damp, and one long abandoned caves in. */
export function pitDay(s: Society, w: Work, keep: boolean): void {
  if (!w.foods) return;
  const T = s.tempC(w.x, w.y), f = w.foods, lone = s.time - (w.opened ?? w.t) > DAY_SECONDS * 20 ? 0.998 : 1;
  const rot = T < -2 ? 0.995 : T > 20 ? 0.65 : T > 10 ? 0.8 : T > 5 ? 0.9 : 0.96;
  /* a granary on posts keeps plant food drier and out of reach of the mice */
  const plantKeep = defOf(w).effects.keep ?? 0.996;
  f.meat *= rot; f.fish *= rot; f.plant *= plantKeep * lone; f.dried *= Math.max(0.999, plantKeep) * lone;
  if (!keep) w.state -= 0.004;
}

/* ---------------- huts ---------------- */

/** How a hut is built where it stands: sunk under turf in a hard winter, on stilts on wet ground, open-sided in the heat. */
export function hutLookAt(s: Society, x: number, y: number): HutLook {
  const c = s.climateAt(x, y);
  if (c.winter < -6) return "cold";
  const W = s.w.w, i = (y | 0) * W + (x | 0);
  if (s.w.biome[i] === Biome.Swamp) return "wet";
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const j = ((y | 0) + dy) * W + (x | 0) + dx, f = s.w.flags[j];
    if (f & Flag.Water && !(f & Flag.River) && Math.hypot(dx, dy) <= 1.6) return "wet";
  }
  if (c.winter > 14 && c.summer > 26) return "hot";
  return "plain";
}
const HUT_WORDS: Record<string, string> = {
  "round|plain": "round hut of thatch over bent poles", "round|cold": "round house sunk into the ground under turf", "round|wet": "round hut raised on stilts", "round|hot": "round shade-house of thatch, open to the breeze",
  "long|plain": "longhouse of bark under a gabled roof", "long|cold": "longhouse sunk into the ground under turf", "long|wet": "longhouse raised on stilts", "long|hot": "long house of thatch with open sides",
  "cone|plain": "tall cone of poles sheathed in bark and hides", "cone|cold": "earth lodge of poles heaped with turf", "cone|wet": "cone of poles raised on stilts", "cone|hot": "tall cone of thatch",
};
export const hutWordsOf = (style: string | undefined, look: string | undefined) => HUT_WORDS[`${style}|${look}`] ?? "hut";
export const hutWords = (w: Work) => ((w.tier ?? 0) >= 1 ? houseWords(w.style, w.walls, w.roof) : hutWordsOf(w.style, w.look));
/** A hut standing and sound enough to live in. */
export const hutStands = (w: Work | undefined | null): boolean => !!w && w.kind === Work.Hut && (w.prog ?? 1) >= 1 && w.state > 0.2;
/** How far a hut reaches from where it stands, for keeping other things clear of it. */
export const hutReach = (w: Work) => (w.style === "long" ? 1.2 + (w.size ?? 1) : 1.8);
/** The households living in a hut: whoever raised it and any who added a bay to a longhouse. */
export const hutHomes = (w: Work): number[] => [w.home, ...(w.bays ?? [])].filter(h => h > 0);
/** Where each household of a longhouse lives along it. */
export function bayAt(w: Work, home: number): [number, number] {
  const k = Math.max(0, hutHomes(w).indexOf(home)), n = Math.max(1, w.size ?? 1);
  return [w.x + (k - (n - 1) / 2) * 2, w.y];
}
/** The hut a household lives in, if it has one standing (or going up) at its band's camp. */
export function hutOf(s: Society, b: Band, home: number): Work | null {
  const h = b.homes.get(home);
  const w = h && h[2] ? workById(s, h[2]) : undefined;
  return w && w.kind === Work.Hut ? w : null;
}

/** Whether a spot is clear: dry, and far enough from huts, pits, plots and other homes. */
export function clearAt(s: Society, b: Band, x: number, y: number, r: number, self = 0, homes?: Map<number, [number, number, number]>): boolean {
  if (!s.walker.dry(x, y)) return false;
  for (const w of worksAround(s, x, y, 7)) {
    if (w.kind === Work.Weir || (w.kind !== Work.Plot && w.home === self && self)) continue;
    const need = w.kind === Work.Hut ? hutReach(w) + r : w.kind === Work.Pit ? 0.9 + r * 0.6 : 1.5 + r * 0.6;
    if (Math.hypot(w.x - x, w.y - y) < need) return false;
  }
  for (const [h, [hx, hy]] of homes ?? b.homes) if (h !== self && Math.hypot(hx - x, hy - y) < r + 0.6) return false;
  for (const o of s.bands) if (o !== b && Math.hypot(o.x - x, o.y - y) < 15) for (const [, [hx, hy]] of o.homes) if (Math.hypot(hx - x, hy - y) < r + 0.6) return false;
  return true;
}

/**
  How much a household hopes to stay where it is: how long the band has been here, food
  that keeps (in the camp and in its own pit), its fields and the band's weir, cold months
  ahead, and how little talk there is of moving on. 0 to 1.
*/
export function stayHope(s: Society, b: Band, home: number): number {
  const days = (s.time - b.movedAt) / DAY_SECONDS;
  let fields = 0, weir = false;
  for (const w of worksAround(s, b.x, b.y, 16)) {
    if (w.kind === Work.Plot && w.home === home) fields++;
    else if (w.kind === Work.Weir && w.band === b.id && w.state > 0.3) weir = true;
  }
  const coldAhead = s.season >= 2 && s.tempC(b.x, b.y, s.time + DAY_SECONDS * 15) < 6;
  let wish = 0, n = 0;
  for (const id of b.members) { const q = s.byId.get(id); if (q && s.age(q) >= 16) { wish += q.moveWish; n++; } }
  return clamp01(0.55 * clamp01(days / 20) + 0.2 * clamp01(pitDays(s, b, home) / 8) + 0.1 * clamp01(keepingDays(b) / 6) + (fields ? 0.12 : 0) + (weir ? 0.1 : 0) + (coldAhead ? 0.15 : 0) - (n ? wish / n : 0) * 0.6);
}

/** A hut to work on for someone's household: its own going up, a longhouse bay to add, a hut to mend, or the spot to start one. */
export interface HutJob { hut: Work | null; x: number; y: number; mend: boolean; bay: boolean; }
export function hutJob(s: Society, p: Person, b: Band): HutJob | null {
  const home = homeOf(p, s.byId, s.time), h = b.homes.get(home); if (!h) return null;
  const own = hutOf(s, b, home);
  if (own) {
    if ((own.prog ?? 1) < 1) return { hut: own, x: own.x, y: own.y, mend: false, bay: false };
    if ((own.ext ?? 0) > 0 && (own.size ?? 1) < 3) return { hut: own, x: own.x, y: own.y, mend: false, bay: true };
    if (own.state < 0.6) return { hut: own, x: own.x, y: own.y, mend: true, bay: false };
    return null;
  }
  /* a people of longhouses: a grown child's household adds a bay to the parents' house, if there is room beside it */
  if (s.cultures[b.culture].hut === "long") {
    for (const w of worksAround(s, b.x, b.y, 14)) {
      if (w.kind !== Work.Hut || w.band !== b.id || !hutStands(w) || (w.size ?? 1) >= 3) continue;
      if (!hutHomes(w).some(o => kinHomes(s, home, o))) continue;
      const side = w.x + ((w.size ?? 1) + 1);
      if (!clearAt(s, b, side, w.y, 1.2, w.home)) continue;
      return { hut: w, x: w.x, y: w.y, mend: false, bay: true };
    }
  }
  /* a hut of its own, where its shelter is if there is room, or a little further out */
  if (clearAt(s, b, h[0], h[1], 1.9, home)) return { hut: null, x: h[0], y: h[1], mend: false, bay: false };
  for (let k = 0; k < 10; k++) {
    const a = (home * 0.61 + k * 0.63) % (Math.PI * 2), r = 4 + (b.homes.size * 0.3) + (k % 3) * 1.4, x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r * 0.8;
    if (clearAt(s, b, x, y, 1.9, home) && s.walker.reach(b.x, b.y, x, y)) return { hut: null, x, y, mend: false, bay: false };
  }
  return null;
}
/** Whether two households are close family: a parent's and a grown child's, or two siblings'. */
function kinHomes(s: Society, a: number, b: number): boolean {
  const p = s.byId.get(a), q = s.byId.get(b);
  return !!p && !!q && (s.kin(p, q, 1) || (!!p.partner && !!s.byId.get(p.partner) && s.kin(s.byId.get(p.partner)!, q, 1)));
}

/** A spell of work on a hut: the poles someone carried lashed into the frame, a bay added, or a worn hut mended. */
export function raise(s: Society, p: Person, st: Step): void {
  const b = s.band(p), home = homeOf(p, s.byId, s.time);
  const poles = p.carryKind === Food.Wood ? p.carryAmt : 0;
  if (poles) { p.carryKind = Food.None; p.carryAmt = 0; }
  /* a family raises a hut in a few days of work: each spell lashes in the poles brought (or turf and reeds cut on the spot) */
  const amt = (0.11 + poles * 0.03) * (knows(p, Idea.Axe) ? 1.3 : 1) * (0.7 + p.skills[Skill.Craft] * 0.6) * (knows(p, Idea.Huts) ? 1 : 0.6);
  let hut = st.id ? workById(s, st.id) ?? null : null;
  if (hut && hut.kind !== Work.Hut) hut = null;
  if (!hut) {
    if (!knows(p, Idea.Huts) || hutOf(s, b, home) || !clearAt(s, b, st.x, st.y, 1.9, home)) return;
    hut = addWork(s, { kind: Work.Hut, x: st.x, y: st.y, wx: st.x, wy: st.y, band: b.id, home, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0, prog: 0, style: s.cultures[b.culture].hut, look: hutLookAt(s, st.x, st.y), size: 1 });
    b.homes.set(home, [st.x, st.y, hut.id]);
  }
  p.skills[Skill.Craft] = Math.min(1, p.skills[Skill.Craft] + 0.004);
  practice(s, p, Idea.Huts, 0.015);
  if (st.a === 1) { hut.state = Math.min(1, hut.state + amt * 2.4); return; }
  if (st.a === 2) {
    /* a bay added to a longhouse for a grown child's family */
    if (!hutHomes(hut).includes(home)) hut.ext = Math.max(hut.ext ?? 0, 0.01);
    hut.ext = (hut.ext ?? 0) + amt * 1.4;
    if (hut.ext >= 1) {
      hut.ext = 0; hut.size = Math.min(3, (hut.size ?? 1) + 1);
      if (!hutHomes(hut).includes(home)) hut.bays = [...(hut.bays ?? []), home];
      s.worksVersion++;
      learnHome(s, b, hut);
      s.relayout(b);
    }
    return;
  }
  const before = hut.prog ?? 0;
  hut.prog = Math.min(1, before + amt);
  if ((before < 0.4) !== (hut.prog < 0.4) || hut.prog >= 1) s.worksVersion++;
  if (hut.prog >= 1 && before < 1) finishHut(s, p, b, hut);
}
function finishHut(s: Society, p: Person, b: Band, hut: Work): void {
  hut.state = 1; hut.built = s.time; hut.site = b.siteName;
  p.prestige += 0.1;
  s.stats.homes.huts++; if (!s.stats.homes.firstHut) s.stats.homes.firstHut = s.time;
  learnHome(s, b, hut);
  const others = worksAround(s, b.x, b.y, 14).filter(w => w.kind === Work.Hut && w.band === b.id && w !== hut && (w.prog ?? 1) >= 1).length;
  const word = hutWords(hut);
  if (!others) s.event("hut", Bubble.Home, `${p.name} of the ${b.name} finished a ${word} for ${p.sex === "f" ? "her" : "his"} family, the band's first hut: a home that will stand while they are away.`, hut.x, hut.y, [p.id], b.id);
  else if (others === 2) s.event("hut", Bubble.Home, `A third hut stands at the camp of the ${b.name}: ${p.name}'s family has raised a ${word}.`, hut.x, hut.y, [p.id], b.id, 1);
}
/** Everyone living in a hut remembers it as home, and where it is. */
export function learnHome(s: Society, b: Band, hut: Work): void {
  const homes = hutHomes(hut);
  for (const id of b.members) { const q = s.byId.get(id); if (q && homes.includes(homeOf(q, s.byId, s.time))) s.learnPlace(q, Place.Home, b.x, b.y, 1, hut.id, 0); }
}

/** Each day: a hut someone lives in wears slowly, an empty one fast; a hut left half built rots where it stands. Returns false when it is gone. */
export function hutDay(s: Society, w: Work): boolean {
  const b = s.bandById.get(w.band);
  const lived = !!b && !b.moving && Math.hypot(b.x - w.x, b.y - w.y) < 14 && hutHomes(w).length > 0;
  if ((w.prog ?? 1) < 1) {
    if (!lived) w.prog = (w.prog ?? 0) - 0.02;
    return (w.prog ?? 0) > 0;
  }
  /* a rebuild nobody is working on comes to nothing */
  if (w.up && !lived) { w.up.prog -= 0.01; if (w.up.prog <= 0) { w.up = undefined; s.worksVersion++; } }
  const before = w.state;
  w.state -= decayOf(w, lived) * (!lived && s.tempC(w.x, w.y) < 0 ? 1.3 : 1);
  if ((before >= 0.55) !== (w.state >= 0.55) || (before >= 0.2) !== (w.state >= 0.2)) s.worksVersion++;
  return w.state > -1.4;
}

/* ---------------- ownership ---------------- */

/** Who carries on a household that no longer exists: the person themself in their new household, else a partner or child in the band. */
function heirOf(s: Society, b: Band, k: number, heads: Set<number>): number {
  const q = s.byId.get(k);
  if (q && q.band === b.id) { const h = homeOf(q, s.byId, s.time); if (heads.has(h)) return h; }
  const a = s.archive.get(k) ?? q;
  if (a) for (const id of [a.partner, ...a.children]) { const o = s.byId.get(id); if (o && o.band === b.id) { const h = homeOf(o, s.byId, s.time); if (heads.has(h)) return h; } }
  return 0;
}
/**
  Households change: couples form and part, people die, grown children set up their own.
  Huts, pits and fields pass to whoever carries the household on; a household that already
  has its own leaves the other free for a family without one.
*/
export function reconcileWorks(s: Society, b: Band, heads: Set<number>): void {
  const near = worksAround(s, b.x, b.y, 16);
  const has = (kind: number, h: number) => near.some(w => w.kind === kind && w.band === b.id && (w.home === h || (w.bays ?? []).includes(h)));
  for (const w of near) {
    if (w.band !== b.id || w.kind === Work.Weir) continue;
    if (w.home && !heads.has(w.home)) {
      const heir = heirOf(s, b, w.home, heads);
      w.home = heir && (w.kind === Work.Plot || !has(w.kind, heir)) ? heir : 0;
    }
    if (w.bays) w.bays = w.bays.map(h => heads.has(h) ? h : heirOf(s, b, h, heads)).filter((h, i, a) => h > 0 && h !== w.home && a.indexOf(h) === i);
    /* a longhouse whose founding family is gone passes to the family in its next bay */
    if (w.kind === Work.Hut && !w.home && w.bays?.length) { w.home = w.bays[0]; w.bays = w.bays.slice(1); }
  }
}

/** Whether a hut is free for a band's families: theirs with nobody in it, or left by a band now gone or camped far away. */
function freeFor(s: Society, b: Band, w: Work, heads: Set<number>): boolean {
  if (!hutStands(w)) return false;
  if (w.band === b.id) return !hutHomes(w).some(h => heads.has(h));
  const o = s.bandById.get(w.band);
  return !o || o.moving !== null || Math.hypot(o.x - w.x, o.y - w.y) > 30;
}

/**
  Lays out the camp: each household at its own hut (or its bay of a longhouse); free huts
  to families without one; then a shelter for everyone else, on a ring around the fire,
  clear of huts, pits and fields. Returns the households' places.
*/
export function layoutCamp(s: Society, b: Band, heads: number[], old: Map<number, [number, number, number]>): Map<number, [number, number, number]> {
  const set = new Set(heads), out = new Map<number, [number, number, number]>();
  reconcileWorks(s, b, set);
  const huts = worksAround(s, b.x, b.y, 14).filter(w => w.kind === Work.Hut);
  for (const w of huts) {
    if (w.band !== b.id) continue;
    for (const h of hutHomes(w)) if (set.has(h) && !out.has(h)) { const [x, y] = (w.prog ?? 1) < 1 ? [w.x, w.y] : bayAt(w, h); out.set(h, [x, y, w.id]); }
  }
  /* empty huts for families without one, the nearest first */
  for (const w of huts) {
    if (!freeFor(s, b, w, set)) continue;
    const want = heads.filter(h => !out.has(h)).sort((a, c) => dist(old.get(a), w) - dist(old.get(c), w) || a - c);
    if (!want.length) break;
    const h = want[0];
    w.band = b.id; w.home = h; w.bays = []; w.size = w.size ?? 1;
    out.set(h, [w.x, w.y, w.id]);
    learnHome(s, b, w);
  }
  /* shelters for the rest */
  const rest = heads.filter(h => !out.has(h)), n = heads.length, built = huts.some(w => w.band === b.id);
  const r = built ? Math.max(4, 2.4 + n * 0.3) : 2.4 + n * 0.16;
  rest.forEach(h => {
    const keep = old.get(h);
    if (keep && !keep[2] && Math.hypot(keep[0] - b.x, keep[1] - b.y) < r + 2 && clearAt(s, b, keep[0], keep[1], 1, h, out)) { out.set(h, [keep[0], keep[1], 0]); return; }
    const k = heads.indexOf(h);
    for (let tries = 0; tries < 18; tries++) {
      const a = (k + tries * 0.37) / Math.max(1, n) * Math.PI * 2 + b.id, rr = r + (tries % 3) * 0.6 + Math.floor(tries / 6) * 1.2;
      const hx = b.x + Math.cos(a) * rr, hy = b.y + Math.sin(a) * rr * 0.8;
      if (clearAt(s, b, hx, hy, 1, h, out)) { out.set(h, [hx, hy, 0]); return; }
    }
    out.set(h, [b.x + 0.5, b.y + 1.5, 0]);
  });
  return out;
}
const dist = (p: [number, number, number] | undefined, w: Work) => (p ? Math.hypot(p[0] - w.x, p[1] - w.y) : 50);

/* ---------------- what a household would lose by leaving ---------------- */

/**
  Days of food and work a household would leave behind if the band moved on: what is in its
  pit beyond what it could carry, its fields' coming harvest, and its hut (a few days of
  hard work, and more with a winter coming).
*/
export function stakeDays(s: Society, b: Band, home: number, fieldHope: number): number {
  const app = householdAppetite(s, b, home), pit = pitOf(s, b, home);
  const coldAhead = s.season >= 2 && s.tempC(b.x, b.y, s.time + DAY_SECONDS * 15) < 6;
  const hut = hutOf(s, b, home);
  const v = ((pit ? Math.max(0, pitFood(pit) - app * 2) : 0) + 0.8 * fieldHope) / app + (hutStands(hut) ? 2 : 0);
  return v * (coldAhead ? 2 : 1);
}

/**
  A band setting off takes what its people can carry, and leaves the rest: in the
  household's pit if it has one (to come back for), otherwise to rot at the old camp (or,
  for families splitting off, with the band they leave). Dried food is carried first,
  fresh meat left first. Returns what was lost.
*/
export function leaveBehind(s: Society, b: Band, into?: Foods): number {
  let can = 0;
  for (const id of b.members) {
    const q = s.byId.get(id); if (!q) continue;
    const a = s.age(q), basket = knows(q, Idea.Baskets);
    can += a >= 15 && a < 66 && !q.baby ? (basket ? 7.5 : 5) : a >= 7 ? (basket ? 3 : 2) : 0;
  }
  let total = storeFood(b.store); for (const h of b.hearths.values()) total += storeFood(h);
  if (total <= can) return 0;
  const keep = can / total, kinds = freezing(s, b) ? FROZEN : KEEPING, to = into;
  let lost = 0;
  const shed = (f: Foods, pit: Work | null) => {
    let drop = storeFood(f) * (1 - keep);
    for (const k of ["meat", "fish", "plant", "dried"] as (keyof Foods)[]) {
      const t = Math.min(f[k], drop); if (t <= 0) continue;
      f[k] -= t; drop -= t;
      const into = pit && pit.foods && kinds.includes(k) ? Math.min(t, pitRoom(pit) - pitFood(pit)) : 0;
      if (into > 0) pit!.foods![k] += into;
      if (to) to[k] += t - into; else lost += t - into;
    }
  };
  shed(b.store, null);
  for (const [head, h] of b.hearths) shed(h, pitOf(s, b, head));
  s.stats.camp.left += lost;
  return lost;
}
