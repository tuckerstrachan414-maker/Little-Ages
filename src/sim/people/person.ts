import type { Genome, Looks } from "./genetics.ts";
import type { Bubble, HairStyle, Stage } from "../../shared/people.ts";
import { DAY_SECONDS, DAYS_PER_YEAR } from "../../shared/types.ts";

/*
  One person. Everything they are is here: their genes and the body those genes built,
  their temperament, what they know how to do, their needs, what they carry, who their
  family is, what they think of everyone they know, what they remember, and the places
  they know of. Nothing about a person is shared with anyone else unless they talk.
*/

export const YEAR = DAY_SECONDS * DAYS_PER_YEAR;

export const Skill = { Gather: 0, Hunt: 1, Fish: 2, Craft: 3 } as const;
export const SKILL_NAMES = ["gathering", "hunting", "fishing", "handcraft"];
/** Things a person knows how to do at all. Children pick them up by watching. */
export const Know = { Fire: 1, Spear: 2, Fishing: 4, Hides: 8, Snares: 16 } as const;
export const KNOW_NAMES: [number, string][] = [[1, "keeping fire"], [2, "spear hunting"], [4, "fishing"], [8, "working hides"], [16, "setting snares"]];

/** What someone is trying to do. Each goal has its own plan and its own "why". */
export const Goal = {
  None: 0, Sleep: 1, Drink: 2, Eat: 3, Gather: 4, Fish: 5, Snare: 6, Hunt: 7, Haul: 8, Wood: 9, Warm: 10, Talk: 11, Court: 12,
  Play: 13, Follow: 14, Explore: 15, Craft: 16, Spear: 17, Tend: 18, Rest: 19, Flee: 20, Migrate: 21, Carried: 22, Sick: 23, Cook: 24, Toddle: 25, Visit: 26,
} as const;
export type Goal = (typeof Goal)[keyof typeof Goal];

export const St = {
  Go: 0, Gather: 1, Fish: 2, Snare: 3, Stalk: 4, Butcher: 5, Wood: 6, Drop: 7, Eat: 8, Drink: 9, Sleep: 10, Sit: 11, Talk: 12,
  Play: 13, Follow: 14, Look: 15, Craft: 16, Knap: 17, Tend: 18, Wait: 19, Cook: 20, Feed: 21,
} as const;
export type St = (typeof St)[keyof typeof St];

export interface Step {
  k: St;
  x: number; y: number;
  /** a person or herd this step is about */
  id: number;
  dur: number;
  /** seconds spent on this step so far */
  t: number;
  run?: boolean;
  /** extra numbers a step needs (amounts, kinds) */
  a?: number;
  /** seconds spent waiting before the step could start */
  w?: number;
}
export const step = (k: St, x = 0, y = 0, id = 0, dur = 0, extra: Partial<Step> = {}): Step => ({ k, x, y, id, dur, t: 0, ...extra });

export const Food = { None: 0, Plant: 1, Meat: 2, Fish: 3, Wood: 4 } as const;

export const Place = { Water: 0, Plants: 1, Fish: 2, Game: 3, Rabbits: 4, Site: 5, Carcass: 6, Camp: 7, Danger: 8 } as const;
export const PLACE_NAMES = ["water", "plant food", "fish", "game", "small game", "a camp site", "a carcass", "a camp", "danger"];
export interface KnownPlace {
  k: number; x: number; y: number;
  /** how good it looked: food units for food, herd size for game, a score for sites */
  q: number;
  /** when it was seen (by whoever saw it) */
  t: number;
  /** who told us (0 if we saw it ourselves) */
  src: number;
  /** herd id, band id or carcass id this place is about */
  ref: number;
  /** herd species */
  sp?: number;
}

export interface Rel {
  /** opinion -1..1 */
  op: number;
  /** how well they know each other 0..1 */
  fam: number;
  /** courtship progress 0..1 */
  court: number;
  seen: number;
}

export const Mem = {
  Shared: 0, Fed: 1, Hungry: 2, Argued: 3, NiceTalk: 4, Stranger: 5, Kill: 6, Attacked: 7, Injured: 8, Birth: 9, Death: 10,
  Paired: 11, Parted: 12, Moved: 13, Split: 14, Learned: 15, Found: 16, Cold: 17, Rejected: 18, Freeloader: 19, Helped: 20, Feast: 21,
} as const;
export interface Memory { t: number; k: number; who: number; v: number; x: number; y: number; n: number; }

export interface Person {
  id: number; name: string; sex: "f" | "m"; born: number;
  genome: Genome; noise: number[]; looks: Looks;
  /** bravery, kindness, greed, ambition, curiosity, sociability, temper, diligence */
  traits: number[];
  skills: number[];
  knows: number;
  mother: number; father: number; partner: number; children: number[];
  /** who looks after a child whose parents are gone */
  guardian: number;
  band: number;
  x: number; y: number; dir: number;

  /* body */
  /** stored food in days of eating, 0..2.5 */
  food: number;
  /** body condition: how well fed they have been over the last days, 0..2 */
  condition: number;
  /** today's running total of food level, for condition */
  dayFood: number;
  water: number; rest: number; warmth: number; company: number; fear: number; health: number;
  /** a water skin, 0 empty .. 1 full (a full skin is most of a day's water) */
  skin: number;
  mood: number;
  /** how hungry childhood has been, 0..1 (stunts growth) */
  childHunger: number;
  injury: number; sick: number;
  /** what has been wearing their health down lately: hunger, thirst, cold, illness, injury */
  harm: number[];
  pregnantBy: number; due: number;
  /** the father's genes, kept from conception (he may not live to see the birth) */
  fatherGenome: Genome | null;
  /** the infant being carried or nursed */
  baby: number;
  /** for an infant: who carries them */
  carrier: number;

  /* things */
  carryKind: number; carryAmt: number; hides: number;
  spear: number;
  /** warmth of the clothes they own: 0 light, 1 hide clothes, 2 furs */
  clothes: number; clothesWear: number;

  /* standing */
  prestige: number;
  /** how much they have brought in and taken out lately (food units per day, smoothed) */
  gave: number; took: number;
  /** food brought to camp today */
  gaveToday: number;
  longing: number;

  /* mind */
  goal: Goal; plan: Step[]; si: number; why: string; whyAt: number;
  path: number[] | null; pi: number;
  anim: number; bubble: Bubble; bubbleUntil: number;
  rel: Map<number, Rel>;
  mem: Memory[];
  places: KnownPlace[];
  moveWish: number; leaveWish: number;
  /** until when they have given up finding a way back to camp and fend for themselves */
  lost: number;
  /** food per trip lately, smoothed */
  tripYield: number;
  nextLook: number; nextDanger: number;
  /** hunting party leader, if in one */
  party: number;
  style: HairStyle;
  lookKey: string;
  /** wants to be taught: a skill index being learned while tagging along */
  learning: number;
}

export interface Archived { id: number; name: string; sex: "f" | "m"; born: number; died: number; x: number; y: number; cause: string; mother: number; father: number; partner: number; children: number[]; band: number; mel: number; }

export const ageOf = (p: { born: number }, now: number) => (now - p.born) / YEAR;
export function stageOf(age: number): Stage {
  return age < 2 ? "baby" : age < 4 ? "toddler" : age < 12 ? "child" : age < 16 ? "teen" : age < 56 ? "adult" : "elder";
}

/** How a person refers to someone else, from the first person's side ("her son", "his mother"). */
export function kinWord(p: Person, otherId: number, other: { sex: "f" | "m"; mother: number; father: number; partner?: number }): string | null {
  if (p.partner === otherId) return p.sex === "f" ? (other.sex === "m" ? "husband" : "partner") : other.sex === "f" ? "wife" : "partner";
  if (p.mother === otherId) return "mother";
  if (p.father === otherId) return "father";
  if (other.mother === p.id || other.father === p.id) return other.sex === "f" ? "daughter" : "son";
  const sharesParent = (p.mother && p.mother === other.mother) || (p.father && p.father === other.father);
  if (sharesParent) {
    const full = p.mother && p.mother === other.mother && p.father && p.father === other.father;
    return (full ? "" : "half-") + (other.sex === "f" ? "sister" : "brother");
  }
  return null;
}
