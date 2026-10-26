/* Shared world types. Every tile is one entry in a set of typed arrays. */

export const SIZES = {
  medium: { w: 1024, h: 512, label: "Medium", plates: 18 },
  large: { w: 2048, h: 1024, label: "Large", plates: 24 },
  huge: { w: 4096, h: 2048, label: "Huge", plates: 32 },
} as const;
export type SizeKey = keyof typeof SIZES;

export const Biome = { DeepOcean: 0, Ocean: 1, Shelf: 2, Lake: 3, River: 4, Beach: 5, Shingle: 6, Cliff: 7, IceSheet: 8, Tundra: 9, Taiga: 10, ColdSteppe: 11, ColdDesert: 12, Grassland: 13, Shrubland: 14, TemperateForest: 15, TemperateRainforest: 16, Savanna: 17, HotDesert: 18, TropicalForest: 19, Rainforest: 20, Swamp: 21, Mountain: 22, SnowPeak: 23 } as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
export const BIOME_NAMES = [
  "Deep ocean", "Ocean", "Shallow sea", "Lake", "River",
  "Sandy beach", "Shingle beach", "Sea cliffs",
  "Ice sheet", "Tundra", "Taiga", "Cold steppe", "Cold desert",
  "Grassland", "Shrubland", "Temperate forest", "Temperate rainforest",
  "Savanna", "Hot desert", "Tropical forest", "Rainforest", "Swamp",
  "Mountains", "Snowy peaks",
];

export const Tree = { None: 0, Oak: 1, Maple: 2, Birch: 3, Beech: 4, Aspen: 5, Willow: 6, Pine: 7, Spruce: 8, Fir: 9, Larch: 10, Palm: 11, Acacia: 12, Baobab: 13, Jungle: 14, Mangrove: 15, Cactus: 16, Snag: 17, BerryBush: 18, Reeds: 19, Shrub: 20, Cypress: 21 } as const;
export type Tree = (typeof Tree)[keyof typeof Tree];
export const TREE_NAMES = ["", "Oak", "Maple", "Birch", "Beech", "Aspen", "Willow", "Pine", "Spruce", "Fir", "Larch",
  "Palm", "Acacia", "Baobab", "Kapok", "Mangrove", "Cactus", "Dead tree", "Berry bush", "Reeds", "Scrub", "Cypress"];
/** Trees that change color and drop their leaves. */
export const DECIDUOUS = new Set<number>([1, 2, 3, 4, 5, 6, 10, 13, 18]);
export const CONIFER = new Set<number>([7, 8, 9, 21]);

export const Flag = { Water: 1, River: 2, Lake: 4, Coast: 8, Ocean: 16 } as const;
export type Flag = (typeof Flag)[keyof typeof Flag];

export type Season = 0 | 1 | 2 | 3;   /* spring, summer, autumn, winter */
export const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"];
export type MapMode = "terrain" | "elevation" | "temperature" | "rainfall" | "biomes";

export interface WorldData {
  w: number; h: number; seed: number; size: SizeKey;
  /** -1..0 below sea level (ocean depth), 0..1 above. */
  elev: Float32Array;
  biome: Uint8Array;
  flags: Uint8Array;
  tree: Uint8Array;
  /** 0..255 */
  temp: Uint8Array;
  /** 0..255 yearly rainfall */
  rain: Uint8Array;
  /** ocean: tiles from land; river: width 1..3 */
  depth: Uint8Array;
  landFraction: number;
  genMs: number;
}

export const DAY_SECONDS = 60;          /* real seconds per day at 1x */
export const DAYS_PER_SEASON = 10;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

export const Species = { Deer: 0, Aurochs: 1, Mammoth: 2, Horse: 3, Wolf: 4, Bear: 5 } as const;
export type Species = (typeof Species)[keyof typeof Species];
export const SPECIES_NAMES = ["Red deer", "Aurochs", "Woolly mammoth", "Wild horses", "Wolves", "Brown bear"];
