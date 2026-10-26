import type { MapMode, Season, SizeKey, WorldData } from "./types.ts";
import type { CampSnap, ChronicleEvent, Look, Stage } from "./people.ts";

/* Messages between the page and the simulation worker. */

export type ToWorker =
  | { type: "generate"; size: SizeKey; seed: number; start: "bands" | "cradle"; bands: number }
  | { type: "speed"; speed: number }
  | { type: "mode"; mode: MapMode }
  | { type: "settime"; time: number }
  /* the person or band the player has pinned a tag to (0 for none) */
  | { type: "inspect"; person: number; band: number };

export type FromWorker =
  | { type: "progress"; stage: number; pct: number }
  | { type: "world"; world: WorldData }
  | { type: "baked"; season: Season; mode: MapMode; pixels: Uint8ClampedArray }
  | { type: "tick"; time: number; speed: number; herds: Float32Array; herdCount: number; animals: number; birds: Float32Array; flockCount: number; birdCount: number;
      people: Float32Array; peopleCount: number; camps: CampSnap[]; looks: Look[]; events: ChronicleEvent[]; pop: number }
  /* small game and fish per 16x16-tile patch, 0..255, sent once a game day */
  | { type: "fields"; gw: number; gh: number; cell: number; rabbits: Uint8Array; fish: Uint8Array; rabbitTotal: number; fishTotal: number }
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
  x: number; y: number;
}

export interface BandDetail {
  id: number; name: string; people: string; pop: number; adults: number; children: number; couples: number;
  respected: { id: number; name: string } | null;
  store: { plant: number; meat: number; fish: number; wood: number; hides: number };
  days: number; fire: number; moves: number; camp: string;
  yesterday: { brought: number; eaten: number };
  shelter: string; sharing: number; cousins: boolean;
  sample: string[];
  members: { id: number; name: string; age: number; sex: "f" | "m"; look: Look }[];
  events: ChronicleEvent[];
  x: number; y: number; moving: boolean;
}
