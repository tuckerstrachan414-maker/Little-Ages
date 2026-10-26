import type { MapMode, Season, SizeKey, WorldData } from "./types.ts";

/* Messages between the page and the simulation worker. */

export type ToWorker =
  | { type: "generate"; size: SizeKey; seed: number }
  | { type: "speed"; speed: number }
  | { type: "mode"; mode: MapMode }
  | { type: "settime"; time: number };

export type FromWorker =
  | { type: "progress"; stage: number; pct: number }
  | { type: "world"; world: WorldData }
  | { type: "baked"; season: Season; mode: MapMode; pixels: Uint8ClampedArray }
  | { type: "tick"; time: number; speed: number; herds: Float32Array; herdCount: number; animals: number; birds: Float32Array; flockCount: number; birdCount: number }
  /* small game and fish per 16x16-tile patch, 0..255, sent once a game day */
  | { type: "fields"; gw: number; gh: number; cell: number; rabbits: Uint8Array; fish: Uint8Array; rabbitTotal: number; fishTotal: number };
