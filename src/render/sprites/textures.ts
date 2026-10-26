import { Biome } from "../../shared/types.ts";
import { hash2 } from "../../shared/rng.ts";

/*
  Close-up ground texture. Each pattern is an 8x8 overlay of light and dark specks, drawn
  over a tile's own color, so a single pattern works for every shade of grass or sand.
  Several variants per ground type keep the tiling from showing.
*/

type Kind = "grass" | "forest" | "sand" | "rock" | "snow" | "desert" | "swamp" | "tundra" | "none";
export function textureKind(b: number): Kind {
  switch (b) {
    case Biome.Grassland: case Biome.Savanna: case Biome.ColdSteppe: case Biome.Shrubland: return "grass";
    case Biome.TemperateForest: case Biome.TemperateRainforest: case Biome.Taiga: case Biome.Rainforest: case Biome.TropicalForest: return "forest";
    case Biome.Beach: return "sand";
    case Biome.HotDesert: case Biome.ColdDesert: return "desert";
    case Biome.Mountain: case Biome.Cliff: case Biome.Shingle: return "rock";
    case Biome.SnowPeak: case Biome.IceSheet: return "snow";
    case Biome.Swamp: return "swamp";
    case Biome.Tundra: return "tundra";
    default: return "none";
  }
}

const LIGHT = "rgba(255,248,220,0.16)", DARK = "rgba(20,24,10,0.18)", DARK2 = "rgba(20,24,10,0.1)";
function pattern(kind: Kind, v: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = 8; c.height = 8; const x = c.getContext("2d")!;
  const dot = (px: number, py: number, col: string) => { x.fillStyle = col; x.fillRect(px & 7, py & 7, 1, 1); };
  const r = (i: number, s: number) => hash2(i, v * 31 + s, 77);
  switch (kind) {
    case "grass": for (let i = 0; i < 3; i++) { const px = Math.floor(r(i, 1) * 7), py = 2 + Math.floor(r(i, 2) * 6); dot(px, py, DARK); dot(px - 1, py - 1, DARK); dot(px + 1, py - 1, DARK); dot(px, py - 2, LIGHT); }
      if (v % 3 === 0) dot(Math.floor(r(9, 3) * 8), Math.floor(r(9, 4) * 8), LIGHT); break;
    case "forest": for (let i = 0; i < 6; i++) dot(Math.floor(r(i, 1) * 8), Math.floor(r(i, 2) * 8), i % 3 ? DARK : DARK2); dot(Math.floor(r(7, 1) * 8), Math.floor(r(7, 2) * 8), LIGHT); break;
    case "sand": { const py = 2 + Math.floor(r(0, 1) * 4); for (let i = 0; i < 4; i++) dot(1 + i + Math.floor(r(1, 2) * 3), py, DARK2); dot(Math.floor(r(2, 3) * 8), Math.floor(r(2, 4) * 8), LIGHT); break; }
    case "desert": for (let i = 0; i < 3; i++) dot(Math.floor(r(i, 1) * 8), Math.floor(r(i, 2) * 8), i ? DARK2 : DARK); { const py = 5 + Math.floor(r(5, 1) * 2); for (let i = 0; i < 3; i++) dot(2 + i, py, LIGHT); } break;
    case "rock": { const px = Math.floor(r(0, 1) * 5), py = Math.floor(r(0, 2) * 5); for (let i = 0; i < 3; i++) dot(px + i, py, LIGHT); for (let i = 0; i < 3; i++) dot(px + 2, py + 1 + i, DARK); dot(px + 1 + Math.floor(r(1, 3) * 3), py + 4, DARK); break; }
    case "snow": dot(Math.floor(r(0, 1) * 8), Math.floor(r(0, 2) * 8), "rgba(255,255,255,0.7)"); dot(Math.floor(r(1, 1) * 8), Math.floor(r(1, 2) * 8), "rgba(120,140,170,0.14)"); break;
    case "swamp": dot(Math.floor(r(0, 1) * 6), Math.floor(r(0, 2) * 6), "rgba(40,70,80,0.3)"); dot(Math.floor(r(0, 1) * 6) + 1, Math.floor(r(0, 2) * 6), "rgba(40,70,80,0.3)"); for (let i = 1; i < 4; i++) dot(Math.floor(r(i, 1) * 8), Math.floor(r(i, 2) * 8), DARK); break;
    case "tundra": for (let i = 0; i < 4; i++) dot(Math.floor(r(i, 1) * 8), Math.floor(r(i, 2) * 8), i % 2 ? DARK2 : "rgba(140,90,80,0.2)"); break;
  }
  return c;
}
const cache = new Map<string, HTMLCanvasElement>();
export function tileTexture(kind: Kind, v: number): HTMLCanvasElement | null {
  if (kind === "none") return null;
  const k = kind + (v % 6); let c = cache.get(k); if (!c) { c = pattern(kind, v % 6); cache.set(k, c); } return c;
}
