/*
  The shape of the tree's nodes, kept apart from the tree itself so the branch files can use
  these names while the tree is still being put together from them.
*/

export const Branch = { Food: 0, Animals: 1, Tools: 2, Crafts: 3, Building: 4, Water: 5, Transport: 6, Knowledge: 7, Healing: 8 } as const;
export const BRANCH_NAMES = ["Food and farming", "Animals and herding", "Tools and weapons", "Crafts and making", "Building", "Water and land", "Transport and trade", "Knowledge and belief", "Healing"];
export const Era = { OldStone: 0, NewStone: 1, Copper: 2, Bronze: 3, Iron: 4, Classical: 5, Medieval: 6, EarlyModern: 7, Industrial: 8, Modern: 9, Space: 10 } as const;
export const ERA_NAMES = ["Old Stone Age", "New Stone Age", "Copper Age", "Bronze Age", "Iron Age", "Classical Age", "Middle Ages", "Age of Sail", "Industrial Age", "Modern Age", "Space Age"];
export const ERA_COUNT = ERA_NAMES.length, BRANCH_COUNT = BRANCH_NAMES.length;

/** What was going on when a piece of work ended, for judging whether a better way would occur to someone. */
export interface Ctx {
  /** gathering: more in the patch than they could carry; little to be had; roots and tubers to dig */
  full?: boolean; poor?: boolean; roots?: boolean;
  /** fishing: in a river or at a narrow channel */
  river?: boolean;
  /** butchering a kill too big to eat before it spoils */
  big?: boolean;
}

/** A node as it is written in the branch files. */
export interface TechSrc {
  /** "pottery": the stable name of the node in data and on the page */
  key: string;
  /** "making fire" */
  name: string;
  /** "how to make fire", for "learned how to make fire" */
  how: string;
  /** a headline for the first time anyone works it out */
  title?: string;
  branch: number; era: number;
  /** what one has to know already, by key */
  needs: string[];
  /** of these, at least one has to be known (milking comes to any herder) */
  any?: string[];
  /** the kinds of work during which it can come to mind, each with a rank for the order they are weighed in */
  during?: { step: number; rank?: number }[];
  /** the wants it answers, weighted: how badly it is needed is the band's problems weighed by these (see tech/problems.ts) */
  problems?: Partial<Record<string, number>>;
  /** the story of its finding, a template with slots: {name} {band} {she} {her} {problem} {context} {season} {where} {how} */
  story?: string;
  /** the age a child can start to pick it up, and how readily they do in a day with someone to learn from */
  age?: number; child?: number;
  /** how readily it is picked up by watching someone at it, and how readily someone who is shown takes it in */
  watch?: number; show?: number;
  /** the skill it draws on, and how much it is worth passing on */
  skill?: number; worth?: number;
  /** how rare a thought it is: the chance, at full need, that a piece of related work brings it to mind */
  spark?: number;
  /** known everywhere when the story begins */
  start?: boolean;
  /** how someone looks while showing it, and its picture */
  anim?: number; icon?: number;
  /** words a village takes from it ("spark", "hill" and "Spark Hill") */
  place?: [string[], string];
  /** whether this build has its triggers, effects and art; the rest are only listed */
  active?: boolean;
}

/** A node of the tree once loaded: its index and resolved needs. The field names of the old `IdeaDef` are kept. */
export interface TechDef {
  key: string;
  /** the index into what each person and band knows */
  id: number;
  name: string; how: string; title: string;
  branch: number; era: number;
  needs: number[]; needKeys: string[];
  any: number[]; anyKeys: string[];
  during: { step: number; rank: number }[];
  problems?: Partial<Record<string, number>>;
  story?: string;
  age: number; child: number; watch: number; show: number; skill: number; worth: number; spark: number;
  start: boolean;
  anim: number; icon: number;
  place?: [string[], string];
  active: boolean;
}
/** The field names the rest of the game has always used for a node. */
export type IdeaDef = TechDef;

/** A row of a branch file: key, name, what it is in "learned how to ..." words, its age, what it builds on, and anything else. */
export const branch = (b: number) => (key: string, name: string, how: string, era: number, needs: string[] = [], o: Partial<TechSrc> = {}): TechSrc => ({ key, name, how, branch: b, era, needs, ...o });
