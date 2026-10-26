import { SIZES, type SizeKey, type WorldData } from "../../shared/types.ts";
import { makePlates, rawElevation, normalizeElevation } from "./elevation.ts";
import { climate } from "./climate.ts";
import { hydrology } from "./hydrology.ts";
import { distances, classify, vegetation } from "./biomes.ts";

export const STAGES = ["Raising continents", "Painting the climate", "Carving rivers and lakes", "Sorting the land", "Growing forests"];
export type Progress = (stage: number, pct: number) => void;

export function generateWorld(size: SizeKey, seed: number, progress: Progress = () => {}): WorldData {
  const t0 = performance.now();
  const { w, h, plates: np } = SIZES[size];
  const plates = makePlates(np, seed, w / h);
  progress(0, 0);
  const elev = rawElevation(w, h, seed, plates, p => progress(0, p * 0.95));
  const landFraction = normalizeElevation(elev, 0.37);
  progress(1, 0);
  const { temp, rain } = climate(w, h, elev, seed, p => progress(1, p));
  const flags = new Uint8Array(w * h), depth = new Uint8Array(w * h);
  progress(2, 0);
  hydrology(w, h, elev, rain, flags, depth, p => progress(2, p));
  progress(3, 0);
  const { toLand, toSea } = distances(w, h, elev, flags);
  const biome = new Uint8Array(w * h);
  classify(w, h, elev, temp, rain, flags, toLand, toSea, seed, biome, depth);
  progress(4, 0);
  const tree = new Uint8Array(w * h);
  vegetation(w, h, elev, temp, rain, biome, flags, seed, tree, p => progress(4, p));
  const t8 = new Uint8Array(w * h), r8 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { t8[i] = Math.round(temp[i] * 255); r8[i] = Math.round(rain[i] * 255); }
  progress(4, 1);
  return { w, h, seed, size, elev, biome, flags, tree, temp: t8, rain: r8, depth, landFraction, genMs: performance.now() - t0 };
}
