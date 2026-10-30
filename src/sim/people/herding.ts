import { Species, DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Mem, Place, St, YEAR, type Person, type Step } from "./person.ts";
import { homeOf, noFood, type Band } from "./band.ts";
import type { Society, Carcass } from "./society.ts";
import { MEAT } from "./society.ts";
import { household, householdAppetite, familyDays } from "./sharing.ts";
import { noteMeal } from "../economy/diet.ts";
import { knows, bandKnows, inspire, practice } from "./ideas.ts";
import { techIx, type Ctx } from "../tech/tree.ts";
import { buildingOf, defOf, standing } from "../buildings/build.ts";
import { Line } from "../buildings/defs.ts";
import { EATS, GRASS, FECUND, MORTAL } from "../wildlife.ts";
import { quality } from "../tech/refine.ts";

/*
  The animals people keep. Nobody is handed a herd: a hunter finds the kid of the goat she
  killed bleating beside it and carries it home instead of leaving it to the wolves; a
  pair of wolf pups, drawn in by the scraps thrown out at a camp, are taken in and fed. Kept
  young eat from the family's hearth, grow, and, untamed and unfolded, slip away in the
  night; a family that feeds and minds them long enough may see what they could be, and
  that is how keeping goats, cattle and pigs, milking, folds and dogs come to a people.
  A flock belongs to a household. It grazes where it stands, breeds in spring, is thinned
  by wolves and by hunger, is milked when it has young and someone knows how, and is eaten
  when the family goes short or the fold is full. Dogs are a flock too: fed meat from the
  hearth, they hunt with the family and keep the wolves off the camp.
*/

export interface Flock {
  id: number;
  /** the band and the household (by its head) that keeps them */
  band: number; home: number;
  sp: number;
  /** grown animals, and young not yet grown */
  n: number; young: number;
  /** how tame: 0 wild-hearted, 1 come when called */
  tame: number;
  /** how well fed lately, 0..1 */
  cond: number;
  /** where they stand today: the fold, beside the hut, or out at grass with the herder */
  x: number; y: number;
  /** the pen they are folded in (a work id, 0 for none) */
  pen: number;
  /** when the keeping began */
  kept: number;
  /** who is out with them today (0 for nobody) */
  herder: number;
  /** wool growing on them (sheep), for shearing later */
  fleece: number;
  /** when an animal was last lost, to wolves or in the night; days on end the dogs have gone unfed; when one was last killed for meat; when someone last minded them */
  lostAt: number; unfed: number; slaughteredAt: number; mindedAt: number;
  /** animals raised in keeping, from young born or brought in */
  born: number;
}

/** The beasts that can be kept, and the way of keeping each that a people may work out. */
export const DOMESTIC = new Set<number>([Species.Goat, Species.Sheep, Species.Aurochs, Species.Boar, Species.Dog]);
export const TAMING: Partial<Record<number, string>> = { [Species.Goat]: "herding-goats-and-sheep", [Species.Sheep]: "herding-goats-and-sheep", [Species.Aurochs]: "herding-cattle", [Species.Boar]: "herding-pigs", [Species.Dog]: "taming-dogs" };
/** singular, plural, a young one, young ones */
const WORDS: Partial<Record<number, [string, string, string, string]>> = {
  [Species.Goat]: ["goat", "goats", "kid", "kids"], [Species.Sheep]: ["sheep", "sheep", "lamb", "lambs"], [Species.Aurochs]: ["cow", "cattle", "calf", "calves"],
  [Species.Boar]: ["pig", "pigs", "piglet", "piglets"], [Species.Dog]: ["dog", "dogs", "pup", "pups"],
};
export const MILKING = () => techIx("milking"), PENNING = () => techIx("penning");
/** How many animals a household can keep without a fold, and a fold of each kind. */
const LOOSE = 8, LOOSE_DOGS = 6;
/** A young animal eats this much of the family's plant food a day while it is hand-fed; a dog this much meat or fish. */
const KID_FOOD = 0.2, DOG_FOOD = 0.1;
/** Milk per grown animal a day, in days of food for one person. */
const MILK: Partial<Record<number, number>> = { [Species.Goat]: 0.25, [Species.Sheep]: 0.2, [Species.Aurochs]: 0.6 };

const her = (p: Person) => (p.sex === "f" ? "her" : "his");
const she = (p: Person) => (p.sex === "f" ? "she" : "he");
const count = (n: number) => (n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : n === 4 ? "four" : `${n}`);

/** "6 goats and 3 kids", "a dog", "two pups" */
export function flockWords(f: Flock): string {
  const w = WORDS[f.sp] ?? ["animal", "animals", "young one", "young ones"];
  const grown = f.n === 1 ? `a ${w[0]}` : f.n > 1 ? `${f.n} ${w[1]}` : "";
  const young = f.young === 1 ? `a ${w[2]}` : f.young > 1 ? `${f.young} ${w[3]}` : "";
  return [grown, young].filter(Boolean).join(" and ") || "no animals";
}
export const speciesWords = (sp: number) => WORDS[sp] ?? ["animal", "animals", "young one", "young ones"];

export const flocksOf = (s: Society, b: Band, home?: number): Flock[] => s.flocks.filter(f => f.band === b.id && (home === undefined || f.home === home));
/** Whether a band has dogs about the camp. */
export const hasDogs = (s: Society, b: Band): boolean => s.flocks.some(f => f.band === b.id && f.sp === Species.Dog && f.n >= 1);
/** How many a household's keeping can hold: its fold, or a few loose about the hut. */
export function capacityOf(s: Society, f: Flock): number {
  if (f.sp === Species.Dog) return LOOSE_DOGS;
  const pen = s.works.find(w => w.id === f.pen);
  return pen && standing(pen) ? defOf(pen).effects.capacity ?? 12 : LOOSE;
}
/** Where a household's animals stand: in the fold, beside the hut, or at the edge of camp. */
export function flockSpot(s: Society, b: Band, f: Flock): [number, number] {
  const pen = f.pen ? s.works.find(w => w.id === f.pen) : undefined;
  if (pen && standing(pen)) return [pen.x, pen.y + 0.3];
  const h = b.homes.get(f.home);
  if (h) return s.dryNear(h[0] + 2.6, h[1] + 0.9, 4);
  return s.dryNear(b.x + 3.2, b.y + 2.2, 4);
}
/** Good grass within a walk of camp for a hungry flock, if any is better than where it stands. */
export function pastureFor(s: Society, b: Band, f: Flock): [number, number] | null {
  const here = s.eco.forageAt(f.x, f.y, GRASS[f.sp]);
  let best: [number, number] | null = null, bv = here * 1.3 + 0.02;
  for (let k = 0; k < 10; k++) {
    const a = (f.id * 0.61 + s.day * 0.37 + k * 0.628) % (Math.PI * 2), r = 5 + (k % 5) * 2;
    const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r * 0.8;
    if (!s.walker.dry(x, y) || !s.walker.reach(b.x, b.y, x, y)) continue;
    const v = s.eco.forageAt(x, y, GRASS[f.sp]);
    if (v > bv) { bv = v; best = [Math.floor(x) + 0.5, Math.floor(y) + 0.5]; }
  }
  return best;
}

function addFlock(s: Society, b: Band, keeper: Person, sp: number, n: number, young: number, tame: number): Flock {
  const home = homeOf(keeper, s.byId, s.time);
  let f = s.flocks.find(o => o.band === b.id && o.home === home && o.sp === sp);
  if (f) { f.n += n; f.young += young; return f; }
  f = { id: s.nextId++, band: b.id, home, sp, n, young, tame, cond: 0.8, x: b.x, y: b.y, pen: 0, kept: s.time, herder: 0, fleece: 0, lostAt: 0, unfed: 0, slaughteredAt: 0, mindedAt: 0, born: 0 };
  [f.x, f.y] = flockSpot(s, b, f);
  s.flocks.push(f);
  if (!s.stats.herds.firstFlock) s.stats.herds.firstFlock = s.time;
  return f;
}

/* ---------------- how keeping begins ---------------- */

/** Butchering a kill with its young standing by: a well-fed family may carry them home instead of leaving them. */
export function keepYoung(s: Society, p: Person, c: Carcass): boolean {
  if (!c.young || !DOMESTIC.has(c.sp)) return false;
  const b = s.band(p);
  if (b.moving || s.age(p) < 14 || !b.homes.has(homeOf(p, s.byId, s.time))) return false;
  const n = c.young; c.young = 0;
  addFlock(s, b, p, c.sp, 0, n, 0);
  s.remember(p, Mem.Kept, 0, 0.5, c.sp);
  s.stats.herds.kept += n;
  if (!b.keptAt || s.time - b.keptAt > YEAR) {
    b.keptAt = s.time;
    const w = speciesWords(c.sp);
    s.event("kept", Bubble.Goat, `${p.name} of the ${b.name} found the ${n === 1 ? w[2] : w[3]} of the ${w[0]} ${she(p)} had killed standing by it, and carried ${n === 1 ? "it" : "them"} home to the hearth instead of leaving ${n === 1 ? "it" : "them"} for the wolves.`, p.x, p.y, [p.id], b.id, 0);
  }
  return true;
}
/** Whether a kill leaves young standing by it: in spring and summer, for the beasts that can be kept, often enough. */
export function youngOf(s: Society, sp: number): number {
  if (!DOMESTIC.has(sp) || sp === Species.Dog || s.season > 1) return 0;
  if (!s.rng.chance(0.35)) return 0;
  return s.rng.chance(0.3) ? 2 : 1;
}

/** Wolf pups come to a camp that throws out scraps; a kind soul takes them in. Once in a long while. */
function pupsDay(s: Society, b: Band): void {
  if (b.moving || b.yesterday.spoiled < 2 || (b.pupsAt && s.time - b.pupsAt < YEAR) || s.time - b.movedAt < DAY_SECONDS * 10) return;
  if (!s.herdsNear(b.x, b.y, 12).some(h => h.sp === Species.Wolf && h.n > 0)) return;
  if (!s.rng.chance(0.02)) return;
  const ms = b.members.map(id => s.byId.get(id)).filter((q): q is Person => !!q && s.age(q) >= 14 && s.age(q) < 60 && b.homes.has(homeOf(q, s.byId, s.time)));
  if (!ms.length) return;
  const keeper = ms.slice().sort((a, c) => c.traits[1] - a.traits[1] || a.id - c.id)[0];
  b.pupsAt = s.time;
  addFlock(s, b, keeper, Species.Dog, 0, 2, 0.5);
  s.remember(keeper, Mem.Kept, 0, 0.4, Species.Dog);
  s.stats.herds.pups += 2;
  s.event("kept", Bubble.Wolf, `Two wolf pups, drawn in by the scraps thrown out at ${b.siteName}, were taken in by ${keeper.name} of the ${b.name} and fed at ${her(keeper)} hearth.`, b.x, b.y, [keeper.id], b.id, 1);
}

/* ---------------- each day ---------------- */

export function flocksDay(s: Society): void {
  for (const b of s.bands) pupsDay(s, b);
  const gone: Flock[] = [];
  for (const f of s.flocks.slice()) {
    const b = s.bandById.get(f.band);
    if (!b) { releaseFlock(s, f); gone.push(f); continue; }
    if (!reconcileFlock(s, b, f)) { gone.push(f); continue; }
    if (b.moving) { f.herder = 0; continue; }
    flockDay(s, b, f);
    if (f.n + f.young <= 0) gone.push(f);
  }
  if (gone.length) s.flocks = s.flocks.filter(f => !gone.includes(f));
}

/** A flock whose household is gone passes to the family's heirs, or to another household of the band; with nobody left, the animals go wild. */
function reconcileFlock(s: Society, b: Band, f: Flock): boolean {
  const heads = s.heads(b);
  if (heads.includes(f.home)) return true;
  if (!heads.length) { releaseFlock(s, f); return false; }
  const q = s.byId.get(f.home), a = s.archive.get(f.home) ?? q;
  let to = q && q.band === b.id ? homeOf(q, s.byId, s.time) : -1;
  if (to < 0 || !heads.includes(to)) {
    const heir = a ? [a.partner, ...a.children].map(id => s.byId.get(id)).find(o => !!o && o.band === b.id) : undefined;
    to = heir ? homeOf(heir, s.byId, s.time) : heads[0];
  }
  if (!heads.includes(to)) to = heads[0];
  const other = s.flocks.find(o => o !== f && o.band === b.id && o.home === to && o.sp === f.sp);
  if (other) { other.n += f.n; other.young += f.young; other.tame = Math.max(other.tame, f.tame); return false; }
  f.home = to; f.pen = 0;
  return true;
}
function releaseFlock(s: Society, f: Flock): void {
  s.wild.release(f.sp, f.x, f.y, f.n + f.young);
  s.stats.herds.escaped += f.n + f.young;
}
/** The animals go wild when their band is no more. */
export function releaseFlocks(s: Society, b: Band): void {
  const mine = s.flocks.filter(f => f.band === b.id);
  for (const f of mine) releaseFlock(s, f);
  if (mine.length) s.flocks = s.flocks.filter(f => f.band !== b.id);
}
/** A household head who goes to live with another band takes the family's animals along. */
export function carryFlocks(s: Society, from: Band, to: Band, head: number): void {
  for (const f of s.flocks) if (f.band === from.id && f.home === head) { f.band = to.id; f.pen = 0; }
}
/** When a band arrives at a new camp, its animals stand at the edge of it, a little the worse for the walk. */
export function flocksArrive(s: Society, b: Band): void {
  for (const f of s.flocks) if (f.band === b.id) { f.cond = Math.max(0, f.cond - 0.05); f.pen = 0; [f.x, f.y] = flockSpot(s, b, f); }
}

function flockDay(s: Society, b: Band, f: Flock): void {
  const now = s.time;
  f.herder = 0;
  const pen = buildingOf(s, b, Line.Pen, f.home);
  f.pen = pen && standing(pen) ? pen.id : 0;
  [f.x, f.y] = flockSpot(s, b, f);
  /* the way of keeping them, once the band knows it, settles the animals */
  const tech = TAMING[f.sp];
  if (tech && bandKnows(b, techIx(tech))) f.tame = Math.max(f.tame, f.sp === Species.Dog ? 1 : 0.3);
  if (f.tame >= 0.3) tamed(s, b, f);
  const h = b.hearths.get(f.home);
  /* feeding */
  let fed: number;
  if (f.sp === Species.Dog) fed = dogsFed(s, b, f);
  else {
    fed = grazeFlock(s, f, f.x, f.y, EATS[f.sp] * (f.n + f.young * 0.5));
    /* hand-fed young eat from the family's plant food, when there is any to spare */
    if (f.young > 0 && h) {
      const spare = Math.max(0, h.plant - householdAppetite(s, b, f.home) * 0.5), give = Math.min(KID_FOOD * f.young, spare);
      if (give > 0) { h.plant -= give; fed = Math.max(fed, Math.min(1, give / (KID_FOOD * f.young))); }
    }
  }
  f.cond = f.cond * 0.85 + fed * 0.15;
  /* deaths: of age and accident (half what the wild takes, kept and watched), and of hunger when the keeping is poor */
  const pDie = MORTAL[f.sp] * 0.5 / DAYS_PER_YEAR + Math.max(0, 0.45 - f.cond) * 0.05;
  for (let m = f.n; m > 0; m--) if (s.rng.chance(pDie)) { f.n--; s.stats.herds.died++; }
  for (let m = f.young; m > 0; m--) if (s.rng.chance(pDie * 1.5)) { f.young--; s.stats.herds.died++; }
  /* the young grow up in a season or so; raised at the hearth, they are a good deal tamer for it */
  for (let m = f.young; m > 0; m--) if (s.rng.chance(1 / DAYS_PER_SEASON)) { f.young--; f.n++; f.born++; f.tame = Math.min(1, f.tame + 0.15); }
  /* births in spring (pigs through the summer too), to a flock in condition, the more readily the tamer they are */
  const breeding = s.season === 0 || (f.sp === Species.Boar && s.season === 1) || (f.sp === Species.Dog && s.season <= 1);
  if (breeding && f.n >= 2 && f.cond > 0.5) {
    const pB = FECUND[f.sp] / DAYS_PER_SEASON * (0.5 + f.tame) * Math.min(1, (f.cond - 0.5) / 0.35);
    for (let m = f.n; m > 0; m--) if (s.rng.chance(pB)) { f.young++; s.stats.herds.born++; }
    /* more pups than a household can feed are given to other hearths, or go their own way */
    if (f.sp === Species.Dog) f.young = Math.max(0, Math.min(f.young, capacityOf(s, f) - f.n));
  }
  /* being about the camp day after day, they lose a little of their fear */
  f.tame = Math.min(1, f.tame + 0.001);
  if (f.sp === Species.Sheep) f.fleece = Math.min(2, f.fleece + 0.01);
  /* wild-hearted animals slip away in the night, unless they are folded */
  if (!f.pen && f.n > 0 && f.sp !== Species.Dog) {
    const pE = f.tame < 0.3 ? 0.02 : 0.003;
    let lost = 0; for (let m = f.n; m > 0; m--) if (s.rng.chance(pE)) lost++;
    if (lost) {
      f.n -= lost; f.lostAt = now; s.stats.herds.escaped += lost;
      s.wild.release(f.sp, f.x, f.y, lost);
      /* never as bitter as a wolf raid, whatever the number: the card tells the two apart by their weight */
      const head = s.byId.get(f.home); if (head) s.remember(head, Mem.HerdLoss, 0, Math.max(-0.29, -0.2 * lost), f.sp);
      herdEvent(s, b, f, lost, false);
    }
  }
  /* wolves in the night: a fold, and dogs, keep most of them off */
  if (f.sp !== Species.Dog && f.n + f.young > 0) {
    const wolves = s.herdsNear(f.x, f.y, 12).filter(o => o.sp === Species.Wolf && o.n > 0), nW = wolves.reduce((a, o) => a + o.n, 0);
    if (nW > 0 && s.rng.chance(wolfRisk(s, b, f, nW))) {
      let lost = Math.min(f.n + f.young, 1 + Math.floor(nW / 3));
      const young = Math.min(f.young, lost); f.young -= young; f.n -= lost - young;
      f.lostAt = now; s.stats.herds.lost += lost;
      for (const o of wolves) o.hunger = Math.max(0, o.hunger - 0.3);
      for (const q of household(s, b, f.home)) if (s.age(q) >= 5) s.remember(q, Mem.HerdLoss, 0, -0.4, f.sp);
      herdEvent(s, b, f, lost, true);
    }
  }
  /* milk, when there are young at foot and someone in the family knows how */
  if (f.young > 0 && f.n > 0 && MILK[f.sp]) milkDay(s, b, f);
  /* meat: when the family goes short, or the keeping is fuller than it can hold */
  if (f.sp !== Species.Dog && f.n > 0 && now - f.slaughteredAt > DAY_SECONDS * 3) {
    const head = s.byId.get(f.home);
    if (head && head.band === b.id) {
      const days = familyDays(s, head), hungry = (days < 0.6 && f.n >= 2) || (days < 0.25 && f.n >= 1), over = f.n + f.young > capacityOf(s, f) && f.n >= 2;
      if (hungry || over) slaughter(s, b, f, head);
    }
  }
}

/** Kept animals crop the patch they stand in: the mix they like first, and when that runs short, whatever else grows there (goats on a bare savanna eat grass; sheep in the scrub browse), a little less well. Returns how much of their need they found, 0..1. */
function grazeFlock(s: Society, f: Flock, x: number, y: number, want: number): number {
  if (want <= 0) return 1;
  const first = s.eco.graze(x, y, want, GRASS[f.sp]);
  if (first >= 0.999) return 1;
  const more = s.eco.graze(x, y, want * (1 - first), GRASS[f.sp] < 0.5 ? 1 : 0);
  return Math.min(1, first + (1 - first) * more * 0.85);
}
/** The odds, tonight, that the wolves get in among a household's animals. */
export function wolfRisk(s: Society, b: Band, f: Flock, nWolves: number): number {
  let risk = Math.min(0.4, 0.04 * nWolves);
  if (hasDogs(s, b)) risk /= 4;
  if (f.pen) { const pen = s.works.find(w => w.id === f.pen); risk /= pen && (pen.tier ?? 0) >= 1 ? 6 : 3; }
  return risk;
}

function dogsFed(s: Society, b: Band, f: Flock): number {
  const want = DOG_FOOD * (f.n + f.young * 0.5); if (want <= 0) return 1;
  let got = 0;
  const flesh = (src: { meat: number; fish: number; dried: number }, up: number) => {
    for (const k of ["meat", "fish", "dried"] as const) { const t = Math.min(src[k], up - got); if (t > 0) { src[k] -= t; got += t; } if (got >= up - 1e-9) break; }
  };
  const h = b.hearths.get(f.home); if (h) flesh(h, want);
  /* the pot feeds the dogs too, when it has plenty */
  if (got < want && b.store.meat + b.store.fish + b.store.dried > b.appetite) flesh(b.store, want);
  /* and dogs hunt for themselves a little */
  const hunted = f.n > 0 ? s.eco.hunt(f.x, f.y, 0.008 * f.n) * 0.2 : 0;
  const fed = Math.min(1, got / want + hunted);
  f.unfed = fed < 0.3 ? f.unfed + 1 : 0;
  if (f.unfed > (f.tame >= 1 ? 6 : 3) && f.n + f.young > 0) {
    if (f.young > 0) f.young--; else f.n--;
    f.unfed = 0; s.stats.herds.strayed++;
    const head = s.byId.get(f.home); if (head) s.remember(head, Mem.HerdLoss, 0, -0.15, Species.Dog);
  }
  return fed;
}

function milkDay(s: Society, b: Band, f: Flock): void {
  const folk = household(s, b, f.home).filter(q => s.age(q) >= 1);
  if (!folk.some(q => knows(q, MILKING()))) return;
  let total = (MILK[f.sp] ?? 0) * f.n * Math.min(1, f.cond + 0.2) * quality(s, b.culture, MILKING());
  if (total <= 0) return;
  s.stats.herds.milk += total;
  /* the little ones first, then everyone, a bowl each */
  for (const q of folk.slice().sort((a, c) => s.age(a) - s.age(c))) {
    if (total <= 0) break;
    const share = Math.min(0.4, total, Math.max(0, 2.5 - q.food)); if (share <= 0) continue;
    q.food += share; total -= share; noteMeal(q, noFood(), share);
    b.today.eaten += share; s.stats.social.eaten += share;
  }
}

function slaughter(s: Society, b: Band, f: Flock, head: Person): void {
  f.n--; f.slaughteredAt = s.time; s.stats.herds.slaughtered++;
  const c: Carcass = { id: s.nextId++, x: f.x, y: f.y, sp: f.sp, meat: MEAT[f.sp] * 0.9, hides: 1, t: s.time, by: head.id };
  s.carcasses.push(c);
  for (const q of household(s, b, f.home)) if (s.age(q) >= 12) s.learnPlace(q, Place.Carcass, c.x, c.y, c.meat, c.id, q === head ? 0 : head.id, s.time, c.sp);
}

function herdEvent(s: Society, b: Band, f: Flock, lost: number, wolves: boolean): void {
  if (b.herdAt && s.time - b.herdAt < DAY_SECONDS * 20) return;
  b.herdAt = s.time;
  const head = s.byId.get(f.home), w = speciesWords(f.sp), left = f.n + f.young, who = head ? `${head.name}'s family` : "a family";
  const text = wolves
    ? `In the night wolves got in among the ${w[1]} ${who} keep at ${b.siteName} and took ${count(lost)}. ${left ? `${count(left).charAt(0).toUpperCase()}${count(left).slice(1)} ${left === 1 ? "is" : "are"} left.` : "None are left."}`
    : `${count(lost).charAt(0).toUpperCase()}${count(lost).slice(1)} of the ${w[1]} ${who} kept at ${b.siteName} wandered off in the night${f.tame < 0.3 ? ", wild-hearted still" : ""}; nobody had thought to fold them.`;
  s.event("herd", wolves ? Bubble.Wolf : Bubble.Goat, text, f.x, f.y, head ? [head.id] : [], b.id, wolves ? 1 : 0);
}

/** The first flock of a kind that comes when called, for a people and for the world. */
function tamed(s: Society, b: Band, f: Flock): void {
  const key = b.culture * 16 + f.sp;
  if (s.tamed.has(key)) return;
  const first = ![...s.tamed].some(k => k % 16 === f.sp);
  s.tamed.add(key);
  if (!s.stats.herds.firstTame) s.stats.herds.firstTame = s.time;
  const head = s.byId.get(f.home), w = speciesWords(f.sp), people = s.cultures[b.culture].lang.name;
  s.event("tamed", f.sp === Species.Dog ? Bubble.Wolf : Bubble.Goat, `The ${people} keep ${w[1]} now: ${head ? `${head.name}'s family` : "a family"} at ${b.siteName} have ${flockWords(f)}, and they come when called.${first ? " Nobody anywhere has kept them before." : ""}`, f.x, f.y, head ? [head.id] : [], b.id, (first ? 2 : 1) * 16 + f.sp);
}

/* ---------------- minding the flock ---------------- */

/** A spell of herding done: the animals fed and watched (out at grass, if `a` is 1), a little tamer for the handling; and the herder, pressed by need, may see what the animals could be. */
export function herdSpell(s: Society, p: Person, st: Step): void {
  const f = s.flocks.find(o => o.id === st.id); if (!f) return;
  const b = s.band(p); if (f.band !== b.id) return;
  f.herder = p.id; f.mindedAt = s.time; s.stats.herds.spells++;
  if (st.a === 1 && f.sp !== Species.Dog) {
    const fed = grazeFlock(s, f, p.x, p.y, EATS[f.sp] * (f.n + f.young * 0.5) * 0.8);
    f.cond = Math.min(1, f.cond + 0.12 * fed);
    /* the flock stands where the herder stands, and is home again by morning */
    f.x = p.x; f.y = p.y;
  }
  f.tame = Math.min(1, f.tame + 0.0015 * (0.6 + p.traits[1] * 0.8));
  const tech = TAMING[f.sp];
  if (tech && knows(p, techIx(tech))) practice(s, p, techIx(tech), 0.005);
  if (f.young > 0 && knows(p, MILKING())) practice(s, p, MILKING(), 0.004);
  if (f.pen && knows(p, PENNING())) practice(s, p, PENNING(), 0.002);
  const wolves = s.herdsNear(f.x, f.y, 14).some(o => o.sp === Species.Wolf && o.n > 0);
  const ctx: Ctx = {
    kept: s.time - f.kept > DAY_SECONDS * 20, young: f.young > 0, wolves, lost: f.lostAt > 0 && s.time - f.lostAt < DAY_SECONDS * 20,
    goats: f.sp === Species.Goat || f.sp === Species.Sheep, cattle: f.sp === Species.Aurochs, pigs: f.sp === Species.Boar, pups: f.sp === Species.Dog && f.tame < 1,
  };
  inspire(s, p, St.Herd, ctx);
  if (f.cond < 0.4) s.bubble(p, Bubble.Goat, 2);
}

/** The animals a person's household keeps, for the cards: "keeps 6 goats and 3 kids, and a dog". */
export function keepsWords(s: Society, p: Person): string {
  const b = s.bandById.get(p.band); if (!b) return "";
  const mine = flocksOf(s, b, homeOf(p, s.byId, s.time)).filter(f => f.n + f.young > 0);
  if (!mine.length) return "";
  const parts = mine.map(flockWords);
  return `keeps ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0]}`;
}
/** A band's animals in words: "two families keep 9 goats and 4 kids and 2 dogs; the goats come when called". */
export function herdsLine(s: Society, b: Band): string {
  const mine = flocksOf(s, b).filter(f => f.n + f.young > 0);
  if (!mine.length) return "";
  const bySp = new Map<number, { n: number; young: number; tame: number; homes: Set<number> }>();
  for (const f of mine) { const o = bySp.get(f.sp) ?? { n: 0, young: 0, tame: 0, homes: new Set() }; o.n += f.n; o.young += f.young; o.tame = Math.max(o.tame, f.tame); o.homes.add(f.home); bySp.set(f.sp, o); }
  const homes = new Set(mine.map(f => f.home));
  const parts = [...bySp].map(([sp, o]) => flockWords({ sp, n: o.n, young: o.young } as Flock));
  const tame = [...bySp].filter(([, o]) => o.tame >= 0.3).map(([sp]) => speciesWords(sp)[1]);
  return `${homes.size === 1 ? "one family keeps" : `${count(homes.size)} families keep`} ${parts.join(" and ")}${tame.length ? `; the ${tame.join(" and ")} come when called` : ""}`;
}
/** Animals at pens and with herders, for the renderer: x, y, species, how many, for each flock of a band at camp. */
export function flockQuads(s: Society, b: Band): number[] {
  const out: number[] = [];
  if (b.moving) return out;
  for (const f of s.flocks) if (f.band === b.id && f.n + f.young > 0) out.push(f.x, f.y, f.sp, f.n + f.young);
  return out;
}
