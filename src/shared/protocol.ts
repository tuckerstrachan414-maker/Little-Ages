import type { MapMode, Season, SizeKey, WorldData } from "./types.ts";
import type { CampSnap, ChronicleEvent, Look, Stage } from "./people.ts";
import type { SearchItem } from "../sim/people/search.ts";

/* Messages between the page and the simulation worker. */

export type ToWorker =
  | { type: "generate"; size: SizeKey; seed: number; start: "bands" | "cradle"; bands: number }
  | { type: "speed"; speed: number }
  | { type: "mode"; mode: MapMode }
  | { type: "settime"; time: number }
  /* the person or band the player has pinned a tag to (0 for none) */
  | { type: "inspect"; person: number; band: number }
  /** look people up by name; answered with `results` carrying the same `seq` */
  | { type: "search"; q: string; seq: number }
  /** relationship threads for everyone in this stretch of map (off turns them off) */
  | { type: "bonds"; on: boolean; view: { x0: number; y0: number; x1: number; y1: number } };

export type FromWorker =
  | { type: "progress"; stage: number; pct: number }
  | { type: "world"; world: WorldData }
  | { type: "baked"; season: Season; mode: MapMode; pixels: Uint8ClampedArray }
  | { type: "tick"; time: number; speed: number; herds: Float32Array; herdCount: number; animals: number; birds: Float32Array; flockCount: number; birdCount: number;
      people: Float32Array; peopleCount: number; camps: CampSnap[]; looks: Look[]; events: ChronicleEvent[]; pop: number }
  /* small game and fish per 16x16-tile patch, 0..255, sent once a game day */
  | { type: "fields"; gw: number; gh: number; cell: number; rabbits: Uint8Array; fish: Uint8Array; rabbitTotal: number; fishTotal: number }
  | { type: "results"; seq: number; items: SearchItem[] }
  /** triples of [person a, person b, bond] (see Bond) */
  | { type: "bonds"; edges: Int32Array }
  | { type: "person"; detail: PersonDetail | null; id: number }
  | { type: "band"; detail: BandDetail | null; id: number };

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
  knows: string[];
  looks: string; look: Look;
  mother: Kin | null; father: Kin | null; partner: Kin | null;
  children: Kin[]; siblings: Kin[]; friends: Kin[]; rivals: Kin[];
  memories: { text: string; ago: number; v: number }[];
  pregnant: boolean; carrying: string; prestige: number; respected: boolean;
  /** days of food at their household's hearth, and in the band's pot */
  hearth: number; pot: number;
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
  store: { plant: number; meat: number; fish: number; wood: number; hides: number };
  days: number; fire: number; moves: number; camp: string;
  yesterday: { brought: number; eaten: number };
  shelter: string; sharing: number; cousins: boolean;
  sample: string[];
  members: { id: number; name: string; age: number; sex: "f" | "m"; look: Look }[];
  events: ChronicleEvent[];
  x: number; y: number; moving: boolean;
}
