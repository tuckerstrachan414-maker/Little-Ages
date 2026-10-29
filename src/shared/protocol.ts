import type { MapMode, Season, SizeKey, WorldData } from "./types.ts";
import type { CampSnap, ChronicleEvent, Look, Stage, VillageSnap, WorkSnap } from "./people.ts";
import type { SearchItem } from "../sim/people/search.ts";
import type { TechDefLite, TechGroup, TechPanelData, TechNodeDetail } from "./tech.ts";

/* Messages between the page and the simulation worker. */

export type ToWorker =
  | { type: "generate"; size: SizeKey; seed: number; start: "bands" | "cradle"; bands: number }
  | { type: "speed"; speed: number }
  | { type: "mode"; mode: MapMode }
  | { type: "settime"; time: number }
  /* the person, band or village the player has pinned a tag to (0 for none) */
  | { type: "inspect"; person: number; band: number; village?: number }
  /** look people up by name; answered with `results` carrying the same `seq` */
  | { type: "search"; q: string; seq: number }
  /** relationship threads for everyone in this stretch of map (off turns them off) */
  | { type: "bonds"; on: boolean; view: { x0: number; y0: number; x1: number; y1: number } }
  /** the tree of knowledge for a group (the world, a people, a settlement): answered with `tech` */
  | { type: "tech"; group: TechGroup }
  /** one node of it, for the card: answered with `technode` */
  | { type: "technode"; id: number; group: TechGroup };

export type FromWorker =
  | { type: "progress"; stage: number; pct: number }
  | { type: "world"; world: WorldData }
  | { type: "baked"; season: Season; mode: MapMode; pixels: Uint8ClampedArray }
  | { type: "tick"; time: number; speed: number; herds: Float32Array; herdCount: number; animals: number; birds: Float32Array; flockCount: number; birdCount: number;
      people: Float32Array; peopleCount: number; camps: CampSnap[]; looks: Look[]; events: ChronicleEvent[]; pop: number;
      /* weirs, plots, huts and pits, sent only when they have changed; villages and gatherings likewise */
      works?: WorkSnap[]; villages?: VillageSnap[] }
  /* small game and fish per 16x16-tile patch, 0..255, and what is left of each deposit, sent once a game day */
  | { type: "fields"; gw: number; gh: number; cell: number; rabbits: Uint8Array; fish: Uint8Array; rabbitTotal: number; fishTotal: number; left: Uint8Array }
  /** what lies in the ground, once after the world; `left` in `fields` says how much of each remains */
  | { type: "deposits"; list: DepositSnap[] }
  /** tiles whose tree changed (felled, fallen, grown back), as [tile index, tree] pairs, sent once a game day when any */
  | { type: "tiles"; changes: Int32Array }
  | { type: "results"; seq: number; items: SearchItem[] }
  /** triples of [person a, person b, bond] (see Bond) */
  | { type: "bonds"; edges: Int32Array }
  /** the tree itself, once after the world */
  | { type: "techtree"; defs: TechDefLite[] }
  | { type: "tech"; data: TechPanelData }
  | { type: "technode"; detail: TechNodeDetail | null }
  | { type: "person"; detail: PersonDetail | null; id: number }
  | { type: "band"; detail: BandDetail | null; id: number }
  | { type: "village"; detail: VillageDetail | null; id: number };

/** A deposit as the page knows it: where, what, how big. */
export interface DepositSnap { id: number; kind: number; name: string; x: number; y: number; r: number; amount: number; }

export interface Kin {
  id: number; name: string; rel: string; alive: boolean; age: number; sex: "f" | "m";
  /** what the inspected person thinks of them, -1..1 */
  op: number;
  look?: Look;
  /** how they died, if dead */
  died?: string;
  /** their band, if not the same */
  band: string;
}

export interface PersonDetail {
  id: number; name: string; sex: "f" | "m"; age: number; stage: Stage;
  band: { id: number; name: string }; people: string;
  doing: string; why: string;
  needs: { food: number; water: number; rest: number; warmth: number; company: number; safety: number; health: number };
  mood: number; moodWord: string; feelings: string[];
  traits: { word: string; v: number; key: string }[];
  skills: { name: string; v: number }[];
  /** what they know how to do: how well (0..1), and how they came to know it ("worked it out", "from her mother, Ama") */
  knows: { id: number; name: string; m: number; how: string; start: boolean }[];
  looks: string; look: Look;
  /** what they have been eating ("eats mostly meat and fish; little plant food") */
  diet: string;
  mother: Kin | null; father: Kin | null; partner: Kin | null;
  children: Kin[]; siblings: Kin[]; friends: Kin[]; rivals: Kin[];
  memories: { text: string; ago: number; v: number }[];
  pregnant: boolean; carrying: string; prestige: number; respected: boolean;
  /** days of food at their household's hearth, and in the band's pot */
  hearth: number; pot: number;
  /** where their household lives ("a round hut of thatch over bent poles", "a shelter", "a hut going up") and the days of food in its pit (-1 for no pit) */
  home: string; pit: number;
  /** whose word they go along with (null when it is their own), and how many listen to them */
  follows: { id: number; name: string } | null; followers: number;
  /** days they have led their band, or -1 */
  leads: number;
  /** how much of what they bring in they share, 0..1 */
  shareRate: number;
  /** feuds they are part of: the other side, what started it, how hot it is, whether it is their own or their family's */
  feuds: Feuding[];
  /** food debts between hearths: owed by them (positive) or to them (negative) */
  owes: { id: number; name: string; amt: number }[];
  x: number; y: number;
}

export interface Feuding { id: number; name: string; heat: number; cause: string; days: number; own: boolean; inherited: boolean; look?: Look; }
export interface BandFeud { a: { id: number; name: string }; b: { id: number; name: string }; heat: number; cause: string; days: number; }

/** A village's card: its name and what the name means, how it began, who lives there, and what they have built and put by. */
export interface VillageDetail {
  id: number; name: string; gloss: string; why: string; story: string; people: string;
  founded: number; founder: { id: number; name: string; alive: boolean };
  bands: { id: number; name: string; pop: number; color: string; leader: { id: number; name: string } | null }[];
  /** whom most of the grown-ups in the village listen to, across its bands, and how many */
  listened: { id: number; name: string; n: number } | null;
  pop: number; peak: number; huts: number; building: number; ruins: number; pits: number; pitDays: number;
  fields: { crop: string; n: number; tame: number }[]; weirs: number;
  /** empty since (0 if lived in) and given up (0 if not) */
  empty: number; abandoned: number;
  events: ChronicleEvent[];
  x: number; y: number;
}

export interface BandDetail {
  id: number; name: string; people: string; pop: number; adults: number; children: number; couples: number;
  respected: { id: number; name: string } | null;
  /** how many listen to the leader and for how many days they have led; a second voice with a following of their own */
  followers: number; ledDays: number;
  contender: { id: number; name: string; followers: number } | null;
  /** each household's hearth: its head, how many live there and days of food */
  hearths: { id: number; name: string; people: number; days: number }[];
  /** days of food in the pot, and the share of yesterday's food that went into it */
  pot: number; sharedYesterday: number;
  feuds: BandFeud[];
  store: { plant: number; meat: number; fish: number; dried: number; wood: number; hides: number };
  /** dried meat and fish in camp, at the hearths and in the pot */
  dried: number;
  /** what the band knows how to do: how many know each thing, and the best at it */
  ideas: { id: number; name: string; start: boolean; n: number; who: { id: number; name: string }[] }[];
  /** the band's weirs and plots, in words */
  works: { kind: "weir" | "plot"; text: string; x: number; y: number }[];
  /** huts, pits and fields at this camp, in a line ("7 huts (2 going up), 5 storage pits holding 140 days of food"), and how long they have stayed and what holds them */
  homes: string; stay: string;
  /** what the band is short of, in a few words ("little to eat, cold nights") */
  needs: string;
  /** the village the band lives in ("" if none) */
  village: string;
  days: number; fire: number; moves: number; camp: string;
  yesterday: { brought: number; eaten: number };
  shelter: string; sharing: number; cousins: boolean;
  sample: string[];
  members: { id: number; name: string; age: number; sex: "f" | "m"; look: Look }[];
  events: ChronicleEvent[];
  x: number; y: number; moving: boolean;
}
