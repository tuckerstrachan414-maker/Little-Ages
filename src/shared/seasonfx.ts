import { Biome, type Season } from "./types.ts";

/* One rule for snow cover, shared by the map painter and the close-up sprites so they always agree. */
const SNOW_T = [0.3, 0.16, 0.34, 0.56];
export function isSnowy(t01: number, biome: number, season: Season, h: number): boolean {
  if (biome === Biome.SnowPeak || biome === Biome.IceSheet) return true;
  if (season === 1 && t01 > 0.08) return false;
  return t01 < SNOW_T[season] + (h - 0.5) * 0.04;
}
export const FREEZE_T = [0.2, 0.08, 0.24, 0.44];
