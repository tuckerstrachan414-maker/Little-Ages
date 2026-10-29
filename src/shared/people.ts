/* What the simulation tells the renderer about people: animations, thought bubbles, looks. */

/** Animations, one per kind of activity, so you can always tell what someone is doing. */
export const Anim = {
  Idle: 0, Walk: 1, Run: 2, Carry: 3, Gather: 4, Dig: 5, Fish: 6, Throw: 7, Butcher: 8, Chop: 9, Knap: 10,
  Sew: 11, Talk: 12, Sit: 13, Sleep: 14, Cook: 15, HoldBaby: 16, Cane: 17, CaneWalk: 18, Play: 19, Wave: 20, Drink: 21, Eat: 22, Sick: 23,
  Build: 24, Shape: 25,
} as const;
export type Anim = (typeof Anim)[keyof typeof Anim];
export const ANIM_NAMES = ["idle", "walk", "run", "carry", "gather", "dig", "fish", "throw", "butcher", "chop", "knap", "sew", "talk", "sit", "sleep", "cook", "holdbaby", "cane", "canewalk", "play", "wave", "drink", "eat", "sick", "build", "shape"] as const;
export type AnimName = (typeof ANIM_NAMES)[number];

/** Picture bubbles over heads: what a conversation is about, or what someone badly needs. */
export const Bubble = {
  None: 0, Berries: 1, Fish: 2, Deer: 3, Heart: 4, Angry: 5, Sun: 6, Baby: 7, Fire: 8, Drop: 9, Meat: 10, Cold: 11,
  Sad: 12, Move: 13, Fear: 14, Zzz: 15, Star: 16, Question: 17, Wolf: 18, Mammoth: 19, Home: 20,
  Gift: 21, Peace: 22, Ask: 23, Pot: 24, Goat: 25,
} as const;
export type Bubble = (typeof Bubble)[keyof typeof Bubble];

/** Per person in each tick: id, x, y, dir (0 south, 1 east, 2 north, 3 west), anim, flags, bubble, mood, carrier id. */
export const PERSON_STRIDE = 9;
export const PFlag = { Carrying: 1, Spear: 2, Sling: 4, Wood: 8, Injured: 16, Sad: 32, Happy: 64, Selected: 128, Pregnant: 256, Meat: 512, Leader: 1024, Chief: 2048 } as const;

export type Stage = "baby" | "toddler" | "child" | "teen" | "adult" | "elder";
export type Wear = "loin" | "wrap" | "tunic" | "dress" | "furs";
/** How a people builds a hut (round huts, longhouses, tall cones), and how it is built where it stands (sunk under turf in the cold, on stilts on wet ground, open-sided in the heat). */
export type HutStyle = "round" | "long" | "cone";
export type HutLook = "plain" | "cold" | "wet" | "hot";
export type HairStyle = "short" | "long" | "wavy" | "shaggy" | "bun" | "topknot" | "braids" | "coils" | "puffs" | "crop" | "bald";

/** How a person looks, sent when someone is born or changes (grows up, grays, dresses for winter). */
export interface Look {
  id: number; name: string; sex: "f" | "m"; stage: Stage; band: number;
  skin: number; hair: string; gray: number; style: HairStyle; beard: boolean; eye: string;
  wear: Wear; top: string; bottom: string; beads: boolean;
  /** dyed trim and belt */
  trim: string;
  /** body paint on bare skin: 0 none, 1 ochre stripes, 2 white clay dots */
  paint: number;
  /** -1 short, 0 middling, 1 tall */
  tall: number;
}

/** A band's camp, sent every tick. `shelters` are [x, y] pairs of households without a hut, `huts` [x, y] pairs of those with one; `racks` are [x, y] pairs of drying racks hung with meat; `flocks` are [x, y, species, count] for the animals households keep, at their folds or out with a herder. */
export interface CampSnap { id: number; name: string; x: number; y: number; color: string; pop: number; fire: number; shelters: number[]; huts: number[]; shelter: "tent" | "leanto" | "dome"; food: number; racks: number[]; flocks: number[]; }
/**
  A fish weir (kind 0), planted plot (1), hut (2) or storage pit (3): where it stands, how it is (repair, or
  growth to ripe at 1), and what it holds. Huts add how far built they are, their style and look, their bays
  and the people's colors; pits whether they stand open and have food in them; fields whether they lie fallow
  and how tame their seed line is.
*/
export interface WorkSnap {
  id: number; kind: number; x: number; y: number; wx: number; wy: number; state: number; food: number; crop: string;
  prog?: number; style?: HutStyle; look?: HutLook; size?: number; hide?: string; trim?: string;
  open?: boolean; fallow?: boolean; tame?: number;
  /** buildings beyond the first huts and pits: tier and def, what they are built of, whose they are, a rebuild in progress (0..1), and the people's way of building */
  tier?: number; def?: string; walls?: string; roof?: string; owner?: number; up?: number; pitch?: number; windows?: number; decor?: number;
  /** a kiln lit */
  firing?: boolean;
}

/**
  A village, a gathering of bands camped together, or the ruins of a village nobody lives in, for the map's labels.
  `bands` are the names of the bands living or camped there; `color` is the first band's.
*/
export interface VillageSnap { id: number; kind: "village" | "gathering" | "ruins"; name: string; gloss: string; x: number; y: number; pop: number; bands: string[]; color: string; band: number; /** hamlet 0, village 1, town 2, city 3 */ tier: number; }

/**
  Something that happened. `sig` (0..1) is how much it matters, weighed from what it was and how rare it is
  in this world's history; `title` is its short headline. Both feed the ribbon, the journal and the Spotlight.
*/
export interface ChronicleEvent { id: number; t: number; kind: string; icon: Bubble; text: string; x: number; y: number; who: number[]; band: number; sig: number; title: string; }
