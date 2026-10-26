/* What the simulation tells the renderer about people: animations, thought bubbles, looks. */

/** Animations, one per kind of activity, so you can always tell what someone is doing. */
export const Anim = {
  Idle: 0, Walk: 1, Run: 2, Carry: 3, Gather: 4, Dig: 5, Fish: 6, Throw: 7, Butcher: 8, Chop: 9, Knap: 10,
  Sew: 11, Talk: 12, Sit: 13, Sleep: 14, Cook: 15, HoldBaby: 16, Cane: 17, CaneWalk: 18, Play: 19, Wave: 20, Drink: 21, Eat: 22, Sick: 23,
} as const;
export type Anim = (typeof Anim)[keyof typeof Anim];
export const ANIM_NAMES = ["idle", "walk", "run", "carry", "gather", "dig", "fish", "throw", "butcher", "chop", "knap", "sew", "talk", "sit", "sleep", "cook", "holdbaby", "cane", "canewalk", "play", "wave", "drink", "eat", "sick"] as const;
export type AnimName = (typeof ANIM_NAMES)[number];

/** Picture bubbles over heads: what a conversation is about, or what someone badly needs. */
export const Bubble = {
  None: 0, Berries: 1, Fish: 2, Deer: 3, Heart: 4, Angry: 5, Sun: 6, Baby: 7, Fire: 8, Drop: 9, Meat: 10, Cold: 11,
  Sad: 12, Move: 13, Fear: 14, Zzz: 15, Star: 16, Question: 17, Wolf: 18, Mammoth: 19, Home: 20,
} as const;
export type Bubble = (typeof Bubble)[keyof typeof Bubble];

/** Per person in each tick: id, x, y, dir (0 south, 1 east, 2 north, 3 west), anim, flags, bubble, mood, carrier id. */
export const PERSON_STRIDE = 9;
export const PFlag = { Carrying: 1, Spear: 2, Sling: 4, Wood: 8, Injured: 16, Sad: 32, Happy: 64, Selected: 128, Pregnant: 256, Meat: 512 } as const;

export type Stage = "baby" | "toddler" | "child" | "teen" | "adult" | "elder";
export type Wear = "loin" | "wrap" | "tunic" | "dress" | "furs";
export type HairStyle = "short" | "long" | "wavy" | "shaggy" | "bun" | "topknot" | "braids" | "coils" | "puffs" | "crop" | "bald";

/** How a person looks, sent when someone is born or changes (grows up, grays, dresses for winter). */
export interface Look {
  id: number; name: string; sex: "f" | "m"; stage: Stage; band: number;
  skin: number; hair: string; gray: number; style: HairStyle; beard: boolean; eye: string;
  wear: Wear; top: string; bottom: string; beads: boolean;
  /** -1 short, 0 middling, 1 tall */
  tall: number;
}

/** A band's camp, sent every tick. */
export interface CampSnap { id: number; name: string; x: number; y: number; color: string; pop: number; fire: number; shelters: number[]; shelter: "tent" | "leanto" | "dome"; food: number; }

export interface ChronicleEvent { id: number; t: number; kind: string; icon: Bubble; text: string; x: number; y: number; who: number[]; band: number; }
