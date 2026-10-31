import { Mat } from "../economy/goods.ts";
import type { HutStyle } from "../../shared/people.ts";

/*
  What people build, as data: every kind of building is a line (houses, stores, wells,
  kilns, pens, halls, shrines, walls, posts, lodges, docks, monuments, roads, bridges,
  workshops) climbed tier by tier, each tier rebuilt in place from the one below as a
  people learns more. A def says what know-how starts it, who it belongs to, what need it
  answers, the materials that have to be carried to the site and the work spells that
  raise it, what it does once it stands, how it wears, and how it is drawn. Huts and
  storage pits are the first tier of the house and store lines, unchanged.
*/

/** The lines of building, by the `kind` a work carries; weirs and plots keep 0 and 1, huts and pits 2 and 3. */
export const Line = { Weir: 0, Plot: 1, House: 2, Store: 3, Well: 4, Kiln: 5, Pen: 6, Hall: 7, Shrine: 8, Wall: 9, Post: 10, Lodge: 11, Dock: 12, Monument: 13, Road: 14, Bridge: 15, Workshop: 16 } as const;
export type Line = (typeof Line)[keyof typeof Line];
export const LINE_NAMES = ["weir", "plot", "house", "store", "well", "kiln", "pen", "hall", "shrine", "wall", "watch post", "lodge", "dock", "monument", "road", "bridge", "workshop"];

export type WallKind = "poles" | "mudbrick" | "daub" | "timber" | "stone" | "brush" | "fence";
export type RoofKind = "thatch" | "turf" | "bark" | "plank" | "none";
export type Owner = "household" | "band" | "settlement";
export type Need = "shelter" | "storage" | "water" | "craft" | "herd" | "meeting" | "defense" | "belief" | "transport";

export interface BuildingDef {
  id: string; line: number; tier: number;
  /** the def this one is rebuilt from, in place */
  from?: string;
  name: string; plural: string;
  /** know-how, any one of which lets someone start it; and what all of them must know besides */
  tech: string[]; techAll?: string[];
  owner: Owner[];
  need: Need;
  /** materials carried to the site before it can be finished, by Mat */
  materials: Partial<Record<number, number>>;
  /** spells of work (one spell is a St.Raise) once the materials are there */
  labor: number;
  footprint: [number, number];
  /** how far it keeps other things clear */
  reach: number;
  effects: Partial<{ room: number; keep: number; warmth: number; dry: number; water: number; capacity: number; batch: number }>;
  /** state lost per day while lived in or kept, while empty, and the state below which it is mended */
  decay: { lived: number; empty: number; mend: number };
  art: { gen: "hut" | "pit" | "proc"; walls?: WallKind[]; roof?: RoofKind[] };
  /** whether it can be built in this build */
  active: boolean;
}

const d = (id: string, line: number, tier: number, name: string, plural: string, o: Partial<BuildingDef> & { tech: string[]; owner: Owner[]; need: Need; materials: Partial<Record<number, number>>; labor: number; art: BuildingDef["art"] }): BuildingDef => ({
  id, line, tier, name, plural, footprint: [2, 2], reach: 1.8, effects: {}, decay: { lived: 0.0016, empty: 0.006, mend: 0.6 }, active: true, ...o,
});

export const DEFS: BuildingDef[] = [
  /* houses: the hut of poles, then a house of mud brick, of wattle and daub, or of hewn timber, then stone */
  d("house0", Line.House, 0, "hut", "huts", { tech: ["huts"], owner: ["household"], need: "shelter", materials: {}, labor: 0, art: { gen: "hut" }, effects: { warmth: 2, dry: 0.5 } }),
  d("house1-mudbrick", Line.House, 1, "house of mud brick", "mud-brick houses", { from: "house0", tech: ["mud-brick"], owner: ["household"], need: "shelter", materials: { [Mat.Clay]: 30, [Mat.Wood]: 10 }, labor: 10, art: { gen: "proc", walls: ["mudbrick"], roof: ["thatch", "turf"] }, effects: { warmth: 4, dry: 1 }, decay: { lived: 0.0008, empty: 0.003, mend: 0.6 } }),
  d("house1-daub", Line.House, 1, "house of wattle and daub", "daub houses", { from: "house0", tech: ["wattle-and-daub"], owner: ["household"], need: "shelter", materials: { [Mat.Clay]: 12, [Mat.Wood]: 14 }, labor: 8, art: { gen: "proc", walls: ["daub"], roof: ["thatch", "turf"] }, effects: { warmth: 3, dry: 1 }, decay: { lived: 0.001, empty: 0.004, mend: 0.6 } }),
  d("house1-timber", Line.House, 1, "house of hewn timber", "timber houses", { from: "house0", tech: ["timber-framing"], owner: ["household"], need: "shelter", materials: { [Mat.Wood]: 36 }, labor: 10, art: { gen: "proc", walls: ["timber"], roof: ["plank", "thatch", "bark"] }, effects: { warmth: 3.5, dry: 1 }, decay: { lived: 0.0009, empty: 0.0035, mend: 0.6 } }),
  d("house2-stone", Line.House, 2, "house of stone", "stone houses", { from: "house1", tech: ["dry-stone-walls"], owner: ["household"], need: "shelter", materials: { [Mat.Stone]: 60, [Mat.Wood]: 20 }, labor: 16, art: { gen: "proc", walls: ["stone"], roof: ["thatch", "plank", "turf"] }, effects: { warmth: 5, dry: 1 }, decay: { lived: 0.0004, empty: 0.0015, mend: 0.6 }, active: false }),
  /* stores: the pit, then a granary raised on posts, then a storehouse of stone */
  d("store0", Line.Store, 0, "storage pit", "storage pits", { tech: ["pits"], owner: ["household"], need: "storage", materials: {}, labor: 0, art: { gen: "pit" }, effects: { room: 40, keep: 0.996 }, reach: 0.9 }),
  d("store1", Line.Store, 1, "granary", "granaries", { from: "store0", tech: ["granary"], owner: ["household", "settlement"], need: "storage", materials: { [Mat.Wood]: 16 }, labor: 8, art: { gen: "proc", walls: ["timber"], roof: ["thatch"] }, effects: { room: 160, keep: 0.998 }, reach: 1.4, decay: { lived: 0.001, empty: 0.004, mend: 0.5 } }),
  d("store2", Line.Store, 2, "storehouse", "storehouses", { from: "store1", tech: ["stone-storehouse"], owner: ["household", "settlement"], need: "storage", materials: { [Mat.Stone]: 40, [Mat.Wood]: 20 }, labor: 14, art: { gen: "proc", walls: ["stone"], roof: ["plank"] }, effects: { room: 400, keep: 0.999 }, reach: 1.8, decay: { lived: 0.0004, empty: 0.0015, mend: 0.5 }, active: false }),
  /* water */
  d("well0", Line.Well, 0, "well", "wells", { tech: ["wells"], owner: ["band", "settlement"], need: "water", materials: { [Mat.Wood]: 4 }, labor: 12, art: { gen: "proc", walls: ["stone"], roof: ["none"] }, effects: { water: 1 }, reach: 1.2, decay: { lived: 0.0005, empty: 0.002, mend: 0.5 } }),
  d("well1", Line.Well, 1, "stone-lined well", "stone wells", { from: "well0", tech: ["cisterns"], owner: ["band", "settlement"], need: "water", materials: { [Mat.Stone]: 24 }, labor: 10, art: { gen: "proc", walls: ["stone"], roof: ["thatch"] }, effects: { water: 1.5 }, reach: 1.2, decay: { lived: 0.0002, empty: 0.001, mend: 0.5 }, active: false }),
  /* craft */
  d("kiln0", Line.Kiln, 0, "kiln", "kilns", { tech: ["kiln-firing"], owner: ["household", "band"], need: "craft", materials: { [Mat.Clay]: 24 }, labor: 6, art: { gen: "proc", walls: ["daub"], roof: ["none"] }, effects: { batch: 2 }, reach: 1.2, decay: { lived: 0.002, empty: 0.005, mend: 0.5 } }),
  d("workshop0", Line.Workshop, 0, "workshop", "workshops", { tech: ["woodworking"], owner: ["household", "band"], need: "craft", materials: { [Mat.Wood]: 24 }, labor: 10, art: { gen: "proc", walls: ["timber"], roof: ["plank"] }, effects: {}, active: false }),
  /* herds */
  d("pen0", Line.Pen, 0, "brush fold", "brush folds", { tech: ["penning"], owner: ["household"], need: "herd", materials: { [Mat.Wood]: 8 }, labor: 4, art: { gen: "proc", walls: ["brush"], roof: ["none"] }, effects: { capacity: 12 }, footprint: [3, 2], reach: 2.2, decay: { lived: 0.002, empty: 0.006, mend: 0.5 } }),
  d("pen1", Line.Pen, 1, "fenced pen", "fenced pens", { from: "pen0", tech: ["penning"], techAll: ["timber-framing"], owner: ["household", "settlement"], need: "herd", materials: { [Mat.Wood]: 20 }, labor: 8, art: { gen: "proc", walls: ["fence"], roof: ["none"] }, effects: { capacity: 30 }, footprint: [4, 3], reach: 2.8, decay: { lived: 0.001, empty: 0.004, mend: 0.5 } }),
  /* the village itself (later checkpoints) */
  d("hall0", Line.Hall, 0, "hall", "halls", { tech: ["hall"], owner: ["settlement"], need: "meeting", materials: { [Mat.Wood]: 40 }, labor: 20, art: { gen: "proc", walls: ["timber"], roof: ["thatch", "plank"] }, footprint: [4, 3], reach: 2.8, active: false }),
  d("shrine0", Line.Shrine, 0, "shrine", "shrines", { tech: ["shrine"], owner: ["settlement", "band"], need: "belief", materials: { [Mat.Wood]: 10, [Mat.Stone]: 6 }, labor: 8, art: { gen: "proc", walls: ["poles"], roof: ["thatch"] }, active: false }),
  d("shrine1-temple", Line.Shrine, 1, "temple", "temples", { from: "shrine0", tech: ["temple"], owner: ["settlement"], need: "belief", materials: { [Mat.Stone]: 120 }, labor: 40, art: { gen: "proc", walls: ["stone"], roof: ["plank"] }, footprint: [4, 4], reach: 3, active: false }),
  d("monument0", Line.Monument, 0, "standing stone", "standing stones", { tech: ["standing-stones"], owner: ["settlement"], need: "belief", materials: { [Mat.Stone]: 40 }, labor: 30, art: { gen: "proc", walls: ["stone"], roof: ["none"] }, decay: { lived: 0.0001, empty: 0.0001, mend: 0.3 }, active: false }),
  d("wall0-palisade", Line.Wall, 0, "palisade", "palisades", { tech: ["palisade"], owner: ["settlement"], need: "defense", materials: { [Mat.Wood]: 60 }, labor: 24, art: { gen: "proc", walls: ["timber"], roof: ["none"] }, footprint: [1, 1], reach: 0.5, active: false }),
  d("wall1-stone", Line.Wall, 1, "stone wall", "stone walls", { from: "wall0-palisade", tech: ["stone-walls"], owner: ["settlement"], need: "defense", materials: { [Mat.Stone]: 200 }, labor: 60, art: { gen: "proc", walls: ["stone"], roof: ["none"] }, footprint: [1, 1], reach: 0.5, active: false }),
  d("post0", Line.Post, 0, "watch post", "watch posts", { tech: ["watch-post"], owner: ["settlement"], need: "defense", materials: { [Mat.Wood]: 16 }, labor: 8, art: { gen: "proc", walls: ["poles"], roof: ["thatch"] }, footprint: [1, 1], reach: 1, active: false }),
  d("lodge0", Line.Lodge, 0, "warriors' lodge", "warriors' lodges", { tech: ["warriors-lodge"], owner: ["settlement"], need: "defense", materials: { [Mat.Wood]: 30 }, labor: 14, art: { gen: "proc", walls: ["timber"], roof: ["thatch"] }, footprint: [3, 3], reach: 2.4, active: false }),
  d("dock0", Line.Dock, 0, "dock", "docks", { tech: ["docks"], owner: ["settlement", "band"], need: "transport", materials: { [Mat.Wood]: 30 }, labor: 12, art: { gen: "proc", walls: ["timber"], roof: ["none"] }, footprint: [3, 1], reach: 1.5, active: false }),
  d("road0", Line.Road, 0, "road", "roads", { tech: ["roads"], owner: ["settlement"], need: "transport", materials: { [Mat.Stone]: 20 }, labor: 10, art: { gen: "proc", walls: ["stone"], roof: ["none"] }, footprint: [1, 1], reach: 0, decay: { lived: 0.0003, empty: 0.001, mend: 0.4 }, active: false }),
  d("bridge0", Line.Bridge, 0, "log bridge", "log bridges", { tech: ["log-bridges"], owner: ["settlement", "band"], need: "transport", materials: { [Mat.Wood]: 24 }, labor: 10, art: { gen: "proc", walls: ["timber"], roof: ["none"] }, footprint: [1, 3], reach: 0.5, active: false }),
];
export const DEF_COUNT = DEFS.length;
const byId = new Map(DEFS.map(x => [x.id, x]));
export function defById(id: string): BuildingDef { const x = byId.get(id); if (!x) throw new Error(`no building ${id}`); return x; }
export const defIndex = (id: string): number => DEFS.findIndex(x => x.id === id);
/** The def a line starts at (tier 0), for works that carry no def of their own: huts and pits. */
export function baseDef(line: number): BuildingDef | undefined { return DEFS.find(x => x.line === line && x.tier === 0); }
/** The defs a building of this def can be rebuilt into, in place. */
export function upgradesOf(def: BuildingDef): BuildingDef[] { return DEFS.filter(x => x.active && x.from && (x.from === def.id || (x.tier === def.tier + 1 && x.line === def.line && x.from === `${LINE_KEY[def.line]}${def.tier}`))); }
const LINE_KEY: Record<number, string> = { [Line.House]: "house", [Line.Store]: "store", [Line.Well]: "well", [Line.Pen]: "pen", [Line.Shrine]: "shrine", [Line.Wall]: "wall" };

/** The words for one of these where it stands, by what it is built of. */
export const WALL_WORDS: Record<WallKind, string> = { poles: "poles", mudbrick: "mud brick", daub: "wattle and daub", timber: "hewn timber", stone: "fitted stone", brush: "tangled brush", fence: "posts and rails" };
export const ROOF_WORDS: Record<RoofKind, string> = { thatch: "thatch", turf: "turf", bark: "bark", plank: "split planks", none: "" };
export function houseWords(style: HutStyle | undefined, walls: WallKind | undefined, roof: RoofKind | undefined): string {
  const shape = style === "long" ? "longhouse" : style === "round" ? "roundhouse" : "house";
  return `${shape} of ${WALL_WORDS[walls ?? "poles"]}${roof && roof !== "none" ? ` under ${ROOF_WORDS[roof]}` : ""}`;
}
/** The total units of material a def takes. */
export const materialTotal = (def: BuildingDef): number => { let t = 0; for (const k in def.materials) t += def.materials[+k] ?? 0; return t; };
