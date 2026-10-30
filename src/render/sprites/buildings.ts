import { FN, shade, mix } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import type { HutLook, HutStyle } from "../../shared/people.ts";
import { grid, put, rect, hline, vline, outlined, toCanvas, SpriteCache, type Grid } from "./grid.ts";

/*
  Buildings made of parts: walls of mud brick, wattle and daub, hewn timber or fitted
  stone under roofs of thatch, turf, bark or split planks, with doors, windows and the
  trim each people likes; granaries raised on posts, wells with a windlass, kilns like
  beehives, folds of brush and pens of posts and rails, and the halls, shrines, walls and
  posts of later ages. Each goes up in stages (a frame, then walls, then done), wears,
  falls to a ruin, and takes snow. A building being rebuilt shows the new frame rising
  around the old. Round peoples build roundhouses, long peoples longhouses with a bay to
  a household, cone peoples square houses under steep roofs. Lit from the top left, 8
  pixels to a tile, like everything else.
*/

export interface BuildingLooks {
  line: number; tier: number;
  style: HutStyle; look: HutLook;
  walls: string; roof: string;
  /** 0 a frame, 1 half built, 2 done */
  stage: number;
  /** 0 sound, 1 worn, 2 a ruin */
  wear: number;
  snow: boolean;
  /** longhouse bays */
  size: number;
  v: number;
  hide: string; trim: string;
  /** the people's way of building: roof steepness, windows per wall (0..2), decoration (0..2) */
  pitch: number; windows: number; decor: number;
  /** a rebuild in place, 0..1, drawn as the new frame rising around the old */
  up?: number;
  /** a kiln lit */
  firing?: boolean;
}

const cache = new SpriteCache();
type Ramp = [string, string, string];
const M: Record<string, Ramp> = {
  thatch: ["#dcc07e", "#c6a25c", "#a3823f"],
  bark: ["#958169", "#7a6450", "#5e4b3b"],
  turf: ["#8a9a58", "#6f7f45", "#55643a"],
  daub: ["#d4b58a", "#b8946a", "#94704c"],
  earth: ["#9a7650", "#7a5c3e", "#5e4630"],
  mudbrick: ["#d9b78a", "#c49a68", "#a07a4e"],
  timber: ["#b08a5a", "#8f6b42", "#6b4e30"],
  plank: ["#9a8468", "#7d6a50", "#5f503c"],
  stone: [FN.rockL, FN.rock, FN.rockD],
};
const POLE = "#6b4a2c", POLE_L = "#8a6040", FRESH = "#c9a878", DARK = "#2e2620", INSIDE = "#3a2e24", SNOW = "#eef1ec", SNOW_D = "#cfd6d2", WEED = ["#6f8f44", "#86a454"], MORTAR = "#8c7a62", TRAMPLED = "#9a8a66", WET = "#6e6450";

export function buildingSprite(b: BuildingLooks): HTMLCanvasElement {
  const key = `b${b.line}|${b.tier}|${b.style}|${b.look}|${b.walls}|${b.roof}|${b.stage}|${b.wear}|${b.snow ? 1 : 0}|${b.size}|${b.v & 3}|${b.hide}|${b.trim}|${Math.round(b.pitch * 10)}|${b.windows}|${b.decor}|${b.up === undefined ? "" : Math.round(b.up * 4)}|${b.firing ? 1 : 0}`;
  return cache.get(key, () => {
    const g = draw(b);
    return toCanvas(outlined(g), { w: Math.round(g.w * 0.9), dy: 0 });
  });
}

function draw(b: BuildingLooks): Grid {
  switch (b.line) {
    case 2: return house(b);
    case 3: return granary(b);
    case 4: return well(b);
    case 5: return kiln(b);
    case 6: return pen(b);
    case 10: return post(b);
    case 9: return wall(b);
    case 13: return monument(b);
    case 12: return dock(b);
    case 14: return road(b);
    case 15: return bridge(b);
    case 8: return shrine(b);
    default: return house({ ...b, style: "long", size: Math.max(2, b.size) });
  }
}

/* ---------------- parts ---------------- */

/** A stretch of wall of one kind, from (x0, y0) w wide and h tall, lit on the left; `seed` varies the blocks. */
function wallBlock(g: Grid, x0: number, y0: number, w: number, h: number, kind: string, seed: number, wear: number): void {
  const r = M[kind] ?? M.daub;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hh = hash2(x0 + x, y0 + y, seed);
    let c: string;
    if (kind === "mudbrick") {
      const course = Math.floor(y / 2), joint = y % 2 === 1 ? false : ((x + (course % 2) * 2) % 4 === 0);
      c = joint || y % 2 === 1 && hh < 0.12 ? MORTAR : x < 2 ? r[0] : x >= w - 2 ? r[2] : hh < 0.1 ? r[0] : hh > 0.9 ? r[2] : r[1];
      if (y % 2 === 1 && !joint) c = x < 2 ? r[0] : x >= w - 2 ? r[2] : hh > 0.85 ? r[2] : r[1];
    } else if (kind === "timber") {
      c = y % 2 === 1 ? r[2] : x < 2 ? r[0] : x >= w - 2 ? r[2] : hh < 0.08 ? r[0] : r[1];
      if ((x - 1) % 6 === 0) c = POLE;
      if (y === h - 1) c = POLE;
    } else if (kind === "stone") {
      const row = Math.floor(y / 3), bx = Math.floor((x + (row % 2) * 2) / 4);
      const bh = hash2(bx, row, seed + 5);
      c = y % 3 === 2 || (x + (row % 2) * 2) % 4 === 0 ? MORTAR : bh < 0.3 ? r[0] : bh > 0.75 ? r[2] : r[1];
      if (x < 1) c = r[0]; if (x >= w - 1 && y % 3 !== 2) c = r[2];
    } else if (kind === "poles" || kind === "brush") {
      c = x % 3 === 0 ? POLE : x % 3 === 1 ? POLE_L : M.thatch[2];
    } else {
      /* daub: smooth, a few lighter patches, the wattle showing where it is worn */
      c = x < 2 ? r[0] : x >= w - 2 ? r[2] : hh < 0.07 ? r[0] : hh > 0.93 ? r[2] : r[1];
      if (wear >= 1 && hh > 0.86 && x % 4 === 1) c = POLE;
    }
    if (wear >= 1 && hh < 0.05) c = mix(c, "#8a8478", 0.4);
    put(g, x0 + x, y0 + y, c);
  }
}
/** A roof row's texture. */
function roofColor(kind: string, x: number, y: number, w: number, seed: number, v: number): string {
  const r = M[kind] ?? M.thatch;
  let c = x < 2 ? r[0] : x >= w - 2 ? r[2] : r[1];
  if (kind === "thatch") { if (y % 3 === 2) c = shade(c, 0.1); else if ((x * 2 + y + v) % 7 === 0) c = r[0]; }
  else if (kind === "turf") { if ((x * 3 + y + v) % 6 === 0) c = r[0]; }
  else if (kind === "bark") { if (x % 5 === v % 5) c = r[2]; }
  else if (kind === "plank") { if (y % 2 === 1) c = r[2]; else if (hash2(x, y, seed) < 0.08) c = r[0]; }
  return c;
}
/** A gabled roof seen from the front: the ridge narrow at the top, the eaves wide at the bottom. */
function gable(g: Grid, rib: Grid, x0: number, y0: number, w: number, h: number, kind: string, seed: number, v: number, stage: number): void {
  for (let y = 0; y < h; y++) {
    const inset = Math.max(0, Math.round((h - 1 - y) * (w * 0.5 - 1) / Math.max(1, h - 1) * 0.55));
    for (let x = inset; x < w - inset; x++) {
      if (stage >= 2 || (stage === 1 && y >= h * 0.5)) put(g, x0 + x, y0 + y, y === h - 1 ? (M[kind] ?? M.thatch)[2] : roofColor(kind, x, y, w, seed, v));
      if (y === 0 || (x - inset) % 4 === 0 || x === inset || x === w - inset - 1) put(rib, x0 + x, y0 + y, y === 0 ? POLE_L : POLE);
    }
  }
}
/** A conical roof over a round wall. */
function cone(g: Grid, rib: Grid, cx: number, y0: number, R: number, h: number, kind: string, seed: number, v: number, stage: number): void {
  for (let y = 0; y < h; y++) {
    const half = Math.min(R, Math.round((y + 1) * R / h));
    for (let x = -half; x <= half; x++) {
      if (stage >= 2 || (stage === 1 && y >= h * 0.5)) put(g, cx + x, y0 + y, y === h - 1 ? (M[kind] ?? M.thatch)[2] : roofColor(kind, x + half, y, half * 2 + 1, seed, v));
      if (x === 0 || Math.abs(x) === half || Math.abs(x) === Math.round(half * 0.5)) put(rib, cx + x, y0 + y, x < 0 ? POLE_L : POLE);
    }
  }
}
function door(g: Grid, x: number, y: number, w: number, h: number, trim: string, v: number): void {
  rect(g, x, y, w, h, DARK);
  hline(g, x, y, w, POLE); put(g, x - 1, y + h - 1, POLE); put(g, x + w, y + h - 1, POLE);
  for (let yy = y + 1; yy < y + h - 1; yy++) put(g, x + w - 1, yy, (yy + v) % 2 ? trim : shade(trim, 0.12));
}
function window(g: Grid, x: number, y: number): void { rect(g, x, y, 2, 2, DARK); hline(g, x - 1, y - 1, 4, POLE); }
function weeds(g: Grid, w: number, y: number, seed: number): void {
  for (let x = 0; x < w; x++) { const hh = hash2(x, 7, seed + 2); if (hh < 0.3) put(g, x, y, hh < 0.12 ? POLE : M.earth[2]); else if (hh > 0.82) { put(g, x, y, WEED[0]); if (hh > 0.92) put(g, x, y - 1, WEED[1]); } }
}
function snowOn(g: Grid, roofRows: (x: number) => number, w: number, depth: number): void {
  for (let x = 0; x < w; x++) { const first = roofRows(x); if (first < 0) continue; for (let y = first; y < first + depth; y++) if (g.px[y * g.w + x] && g.px[y * g.w + x] !== DARK && (y - first < 2 || (x + y) % 2 === 0)) put(g, x, y, y - first < 1 ? SNOW : SNOW_D); }
}
/** A bundle of what the site is waiting for, beside a building still going up. */
function bundle(g: Grid, x: number, y: number, kind: string): void {
  if (kind === "stone" || kind === "mudbrick") { const c = kind === "stone" ? M.stone : M.mudbrick; put(g, x, y, c[1]); put(g, x + 1, y, c[2]); put(g, x + 2, y, c[1]); put(g, x + 1, y - 1, c[0]); }
  else { for (let i = 0; i < 5; i++) put(g, x + i, y, i % 2 ? POLE_L : POLE); hline(g, x + 1, y - 1, 3, M.thatch[1]); }
}
/** The posts of a new frame rising around a building being rebuilt. */
function rebuilding(g: Grid, W: number, H: number, up: number): void {
  const h = Math.max(2, Math.round(H * Math.min(1, up + 0.25)));
  for (const x of [0, W - 1]) for (let y = H - 1; y > H - 1 - h; y--) put(g, x, y, (y + x) % 2 ? FRESH : POLE_L);
  if (up >= 0.5) hline(g, 0, Math.max(0, H - h), W, FRESH);
  bundle(g, W - 7, H - 1, "wood");
}
/** Wear and ruin applied to a finished covering: holes in the roof, then the roof gone and the walls down. */
function ruin(g: Grid, rib: Grid, W: number, H: number, wear: number, roofBottom: number, seed: number): void {
  if (wear < 1) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!g.px[i]) continue;
    const hh = hash2(x, y, seed + 9);
    if (wear === 1) { if (y < roofBottom && hh < 0.08) g.px[i] = rib.px[i] ?? INSIDE; continue; }
    /* a ruin: the roof gone but for a few ribs, the walls holed and lowered */
    if (y < roofBottom) g.px[i] = rib.px[i] && hh > 0.45 ? rib.px[i] : null;
    else if (y < roofBottom + (H - roofBottom) * 0.45 || hh < 0.3) g.px[i] = rib.px[i] && hh > 0.5 ? rib.px[i] : (hh < 0.12 ? mix(g.px[i]!, "#7a7466", 0.4) : null);
  }
  if (wear >= 2) weeds(g, W, H - 1, seed);
}

/* ---------------- houses ---------------- */

function house(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 41 + v * 7 + b.tier * 3;
  const cold = b.look === "cold";
  if (b.style === "round") return roundhouse(b, v, seed);
  const n = b.style === "long" ? Math.max(1, Math.min(3, b.size)) : 1;
  const W = b.style === "long" ? 10 + 16 * n : 22, wallH = cold ? 5 : 8, roofH = Math.max(5, Math.round((b.style === "long" ? 8 : 10) * b.pitch)), H = roofH + wallH;
  const g = grid(W, H), rib = grid(W, H);
  const roofKind = cold && b.roof === "thatch" ? "turf" : b.roof;
  /* the walls, as far as they are built */
  const built = b.stage >= 2 ? wallH : b.stage === 1 ? Math.ceil(wallH * 0.6) : 0;
  if (built > 0) wallBlock(g, 1, H - built, W - 2, built, b.walls, seed, b.wear);
  /* corner posts and the sill, always */
  for (const x of [1, W - 2]) vline(rib, x, roofH, wallH, POLE);
  if (b.style === "long") for (let k = 1; k < n; k++) vline(rib, 1 + k * 16, roofH, wallH, POLE);
  hline(rib, 1, H - 1, W - 2, POLE);
  gable(g, rib, 0, 0, W, roofH, roofKind, seed, v, b.stage);
  if (b.stage >= 2 && b.wear < 2) {
    /* doors: one to a bay; windows as the people likes them; trim under the eaves */
    const doors = b.style === "long" ? n : 1;
    for (let k = 0; k < doors; k++) { const dx = b.style === "long" ? 5 + k * 16 + 4 : Math.floor(W / 2) - 1; door(g, dx, H - (cold ? 4 : 6), 3, cold ? 4 : 6, b.trim, v); }
    if (b.windows > 0 && !cold) {
      const step = b.windows >= 2 ? 6 : 9;
      for (let x = 4; x < W - 5; x += step) { const dx = b.style === "long" ? 5 + Math.floor((x - 5) / 16) * 16 + 4 : Math.floor(W / 2) - 1; if (Math.abs(x - dx) < 3) continue; window(g, x, roofH + 2); }
    }
    if (b.decor >= 1) for (let x = 2; x < W - 2; x += 2) put(g, x, roofH, b.trim);
    if (b.decor >= 2) { put(g, W - 4, H - 1, "#a0523a"); put(g, W - 4, H - 2, "#b5603a"); }
    if (b.style === "cone" && b.hide) { const dx = Math.floor(W / 2) - 1; for (let x = dx - 1; x <= dx + 3; x++) put(g, x, H - 7, b.hide); }
  }
  if (cold && b.stage >= 2) { put(g, Math.floor(W / 2), 1, DARK); put(g, Math.floor(W / 2) + 1, 1, DARK); }
  /* frame and rib showing where there is no covering */
  for (let i = 0; i < W * H; i++) if (!g.px[i] && rib.px[i]) g.px[i] = rib.px[i];
  ruin(g, rib, W, H, b.wear, roofH, seed);
  if (b.stage < 2 && b.wear < 2) bundle(g, W - 7, H - 1, b.walls === "stone" ? "stone" : b.walls === "mudbrick" ? "mudbrick" : "wood");
  if (b.snow && b.stage >= 1) snowOn(g, x => { for (let y = 0; y < roofH; y++) if (g.px[y * W + x]) return y; return -1; }, W, cold ? 4 : 3);
  if (b.up !== undefined) rebuilding(g, W, H, b.up);
  return g;
}
function roundhouse(b: BuildingLooks, v: number, seed: number): Grid {
  const cold = b.look === "cold";
  const W = 24, R = 11, wallH = cold ? 4 : 7, roofH = Math.max(6, Math.round(9 * b.pitch)), H = roofH + wallH, cx = 12;
  const g = grid(W, H), rib = grid(W, H);
  const built = b.stage >= 2 ? wallH : b.stage === 1 ? Math.ceil(wallH * 0.6) : 0;
  /* a round wall reads as a band with rounded ends */
  if (built > 0) { wallBlock(g, 1, H - built, W - 2, built, b.walls, seed, b.wear); for (const y of [H - built]) { put(g, 1, y, null); put(g, W - 2, y, null); } }
  for (const x of [1, cx, W - 2]) vline(rib, x, roofH, wallH, POLE);
  hline(rib, 1, H - 1, W - 2, POLE);
  cone(g, rib, cx, 0, R, roofH, cold && b.roof === "thatch" ? "turf" : b.roof, seed, v, b.stage);
  if (b.stage >= 2 && b.wear < 2) {
    door(g, cx - 1, H - (cold ? 4 : 6), 3, cold ? 4 : 6, b.trim, v);
    if (b.windows > 0 && !cold) { window(g, 4, roofH + 2); if (b.windows >= 2) window(g, W - 6, roofH + 2); }
    if (b.decor >= 1) for (let x = 2; x < W - 2; x += 2) put(g, x, roofH, b.trim);
    if (b.decor >= 2) { put(g, W - 4, H - 1, "#a0523a"); put(g, W - 4, H - 2, "#b5603a"); }
  }
  if (b.stage >= 2) { put(g, cx, 0, DARK); }
  for (let i = 0; i < W * H; i++) if (!g.px[i] && rib.px[i]) g.px[i] = rib.px[i];
  ruin(g, rib, W, H, b.wear, roofH, seed);
  if (b.stage < 2 && b.wear < 2) bundle(g, W - 7, H - 1, b.walls === "stone" ? "stone" : b.walls === "mudbrick" ? "mudbrick" : "wood");
  if (b.snow && b.stage >= 1) snowOn(g, x => { for (let y = 0; y < roofH; y++) if (g.px[y * W + x]) return y; return -1; }, W, cold ? 4 : 3);
  if (b.up !== undefined) rebuilding(g, W, H, b.up);
  return g;
}

/* ---------------- granaries, wells, kilns, pens ---------------- */

/** A granary: a box of planks raised on posts with rodent guards, a thatch roof, a ladder. */
function granary(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 61 + v, W = 18, H = 19, g = grid(W, H), rib = grid(W, H);
  const postH = 6, boxH = 6, roofH = 5, boxY = H - postH - boxH;
  for (const x of [3, 8, 14]) { vline(g, x, H - postH, postH, x === 3 ? POLE_L : POLE); hline(g, x - 1, H - postH, 3, FN.rockL); }
  if (b.stage >= 1) {
    const h = b.stage >= 2 ? boxH : 3;
    wallBlock(g, 2, boxY + boxH - h, W - 4, h, b.wear >= 2 ? "poles" : "timber", seed, b.wear);
    hline(g, 2, boxY + boxH - 1, W - 4, POLE);
  } else { for (const x of [2, W - 3]) vline(rib, x, boxY, boxH, POLE); hline(rib, 2, boxY + boxH - 1, W - 4, POLE); }
  gable(g, rib, 0, boxY - roofH, W, roofH, b.roof === "none" ? "thatch" : b.roof, seed, v, b.stage);
  if (b.stage >= 2 && b.wear < 2) { rect(g, 7, boxY + 1, 3, 3, DARK); hline(g, 7, boxY + 1, 3, POLE); }
  /* the ladder */
  for (let y = boxY + 2; y < H; y++) { put(g, W - 2, y, POLE); put(g, W - 1, y, y % 2 ? POLE_L : null); }
  for (let i = 0; i < W * H; i++) if (!g.px[i] && rib.px[i]) g.px[i] = rib.px[i];
  ruin(g, rib, W, H, b.wear, boxY, seed);
  if (b.stage < 2 && b.wear < 2) bundle(g, 0, H - 1, "wood");
  if (b.snow && b.stage >= 1) snowOn(g, x => { for (let y = 0; y < boxY; y++) if (g.px[y * W + x]) return y; return -1; }, W, 3);
  if (b.up !== undefined) rebuilding(g, W, H, b.up);
  return g;
}
/** A well: a ring of stone over the shaft, a windlass on two posts with a bucket, wet ground around. */
function well(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 71 + v, W = 14, H = 14, g = grid(W, H), cx = 7;
  /* wet, trampled ground */
  for (let x = 1; x < W - 1; x++) for (let y = H - 4; y < H; y++) if (hash2(x, y, seed) < 0.55 && Math.hypot((x - cx) / 6.5, (y - (H - 2)) / 2.2) < 1) put(g, x, y, (x + y) % 2 ? WET : TRAMPLED);
  if (b.stage === 0) {
    /* a hole and the earth dug out of it */
    for (let x = cx - 3; x <= cx + 3; x++) for (let y = H - 4; y < H - 1; y++) if (Math.hypot((x - cx) / 3.2, (y - (H - 2.5)) / 1.6) < 1) put(g, x, y, y === H - 4 ? INSIDE : DARK);
    for (let x = cx - 5; x <= cx + 5; x++) { const d = Math.abs(x - cx); if (d >= 3) put(g, x, H - 2, M.earth[1]); if (d >= 4) put(g, x, H - 3, M.earth[0]); }
    bundle(g, 0, H - 1, "wood");
    return g;
  }
  /* the ring of stone */
  for (let x = cx - 4; x <= cx + 4; x++) for (let y = H - 6; y < H - 1; y++) {
    const d = Math.hypot((x - cx) / 4.4, (y - (H - 3.5)) / 2.2);
    if (d > 1) continue;
    if (d < 0.55) { put(g, x, y, y < H - 4 ? INSIDE : DARK); continue; }
    const bh = hash2(x, y, seed + 1); put(g, x, y, y === H - 6 || x === cx - 4 ? M.stone[0] : bh < 0.3 ? M.stone[0] : bh > 0.7 ? M.stone[2] : M.stone[1]);
    if ((x + y) % 3 === 0 && y > H - 6) put(g, x, y, MORTAR);
  }
  if (b.stage >= 2 && b.wear < 2) {
    /* the windlass: two posts, a crossbar, the rope and the bucket */
    for (const x of [cx - 4, cx + 4]) vline(g, x, 2, H - 7, x < cx ? POLE_L : POLE);
    hline(g, cx - 5, 2, 11, POLE_L); put(g, cx - 5, 3, POLE); put(g, cx + 5, 3, POLE);
    put(g, cx + 1, 3, DARK); put(g, cx + 1, 4, DARK); put(g, cx + 1, 5, DARK);
    rect(g, cx, 6, 3, 2, M.bark[1]); hline(g, cx, 6, 3, M.bark[0]);
    if (b.roof === "thatch") { gable(g, grid(W, H), 0, 0, W, 3, "thatch", seed, v, 2); }
  } else if (b.wear >= 2) { weeds(g, W, H - 1, seed); }
  if (b.snow) for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) if (g.px[y * W + x]) { put(g, x, y, SNOW); break; } }
  if (b.up !== undefined) rebuilding(g, W, H, b.up);
  return g;
}
/** A kiln: a beehive of daub with a mouth for the fire; smoke when it is lit. */
function kiln(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 81 + v, W = 12, H = 13, g = grid(W, H), cx = 5, Hd = 9, R = 5;
  const rows = b.stage >= 2 ? Hd : b.stage === 1 ? 5 : 2;
  for (let y = Hd - rows; y < Hd; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((Hd - 1 - y) / (Hd - 0.5)) ** 2)) * R);
    for (let x = -half; x <= half; x++) {
      const hh = hash2(x, y, seed);
      let c = x <= -half + 1 ? M.daub[0] : x >= half - 1 ? M.daub[2] : hh < 0.1 ? M.daub[0] : M.daub[1];
      if (b.wear >= 1 && hh > 0.88) c = DARK; if (b.wear >= 2 && hh > 0.6) continue;
      put(g, cx + x, y + 3, c);
    }
  }
  if (b.stage >= 2) {
    rect(g, cx - 1, Hd, 3, 2, b.firing ? FN.fire : DARK); if (b.firing) { put(g, cx, Hd, FN.fireL); put(g, cx, 2, DARK); }
    if (b.firing) for (const [dx, dy] of [[0, 1], [1, 0], [-1, -1], [0, -2]]) put(g, cx + dx, 2 + dy, FN.smoke);
    if (b.wear < 2) { put(g, cx + 4, H - 1, "#a0523a"); put(g, cx + 5, H - 1, "#b5603a"); put(g, cx + 4, H - 2, "#a0523a"); }
  }
  hline(g, 0, H - 1, W, TRAMPLED);
  if (b.stage < 2 && b.wear < 2) bundle(g, 0, H - 1, "mudbrick");
  if (b.wear >= 2) weeds(g, W, H - 1, seed);
  if (b.snow && b.stage >= 2 && !b.firing) for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) if (g.px[y * W + x]) { put(g, x, y, SNOW); break; } }
  return g;
}
/** A fold of tangled brush, or a pen of posts and rails: a ring with an opening at the front. */
function pen(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 91 + v, fence = b.walls === "fence", W = fence ? 30 : 24, H = fence ? 16 : 13, g = grid(W, H), cx = W / 2, cy = H - 5, rx = W / 2 - 1, ry = 4.2;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const d = Math.hypot((x - cx) / rx, (y - cy) / ry); if (d < 0.95 && hash2(x, y, seed) < 0.5) put(g, x, y, (x + y) % 2 ? TRAMPLED : "#a89a74"); }
  const done = b.stage >= 2 ? 1 : b.stage === 1 ? 0.5 : 0.2;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry), ang = (Math.atan2(y - cy, x - cx) / (Math.PI * 2) + 1.25) % 1;
    if (d < 0.86 || d > 1.0) continue;
    if (ang > 0.44 && ang < 0.56 && y > cy) continue;   /* the opening, at the front */
    if (ang > done) continue;
    const hh = hash2(x, y, seed + 1);
    if (fence) {
      /* two rails along the ring, a post every few steps */
      if (d > 0.92) { put(g, x, y, POLE_L); put(g, x, y - 2, POLE_L); }
      if (x % 4 === (v % 4) && d > 0.92) { put(g, x, y, POLE); put(g, x, y - 1, POLE); put(g, x, y - 2, POLE); put(g, x, y - 3, POLE_L); }
    }
    else put(g, x, y, hh < 0.3 ? POLE : hh < 0.6 ? POLE_L : hh < 0.8 ? M.bark[2] : M.thatch[2]);
    if (!fence && hh > 0.85 && d > 0.9) put(g, x, y - 1, POLE_L);
  }
  if (b.wear >= 2) weeds(g, W, H - 1, seed);
  if (b.snow) for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) if (g.px[y * W + x] && hash2(x, y, 3) < 0.6) { put(g, x, y, SNOW_D); break; } }
  if (b.up !== undefined) rebuilding(g, W, H, b.up);
  return g;
}

/* ---------------- the village's later buildings ---------------- */

function post(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 101 + v, W = 11, H = 20, g = grid(W, H), rib = grid(W, H), cx = 5;
  vline(g, cx - 2, 4, H - 4, POLE_L); vline(g, cx + 2, 4, H - 4, POLE); for (let y = 6; y < H; y += 3) { put(g, cx - 1, y, POLE); put(g, cx, y, POLE_L); put(g, cx + 1, y, POLE); }
  if (b.stage >= 2) { hline(g, cx - 4, 5, 9, M.plank[0]); hline(g, cx - 4, 6, 9, M.plank[2]); gable(g, rib, 0, 0, W, 4, "thatch", seed, v, 2); }
  for (let i = 0; i < W * H; i++) if (!g.px[i] && rib.px[i]) g.px[i] = rib.px[i];
  ruin(g, rib, W, H, b.wear, 5, seed);
  return g;
}
function wall(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 111 + v, W = 9, H = 11, g = grid(W, H);
  if (b.walls === "stone") { wallBlock(g, 0, 2, W, H - 2, "stone", seed, b.wear); for (let x = 0; x < W; x += 2) put(g, x, 1, M.stone[0]); }
  else for (let x = 0; x < W; x++) { const h = b.stage >= 2 ? 9 - (hash2(x, 0, seed) < 0.3 ? 1 : 0) : 4; for (let y = H - h; y < H; y++) put(g, x, y, x % 2 ? POLE : POLE_L); put(g, x, H - h - 1, x % 2 ? POLE_L : FRESH); }
  if (b.wear >= 2) for (let x = 0; x < W; x++) if (hash2(x, 1, seed) < 0.4) for (let y = 0; y < H - 3; y++) put(g, x, y, null);
  return g;
}
function monument(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 121 + v, W = 12, H = 18, g = grid(W, H), cx = 5;
  for (let x = 1; x < W - 1; x++) put(g, x, H - 1, M.turf[1]);
  const h = b.stage >= 2 ? 15 : b.stage === 1 ? 7 : 3;
  for (let y = H - 1 - h; y < H - 1; y++) for (let x = cx - 2; x <= cx + 2; x++) { const hh = hash2(x, y, seed); put(g, x, y, x === cx - 2 ? M.stone[0] : x === cx + 2 ? M.stone[2] : hh < 0.15 ? M.stone[0] : hh > 0.85 ? M.stone[2] : M.stone[1]); }
  put(g, cx - 2, H - 1 - h, null); put(g, cx + 2, H - 1 - h, null);
  if (b.stage < 2) bundle(g, 7, H - 1, "stone");
  return g;
}
function dock(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 131 + v, W = 16, H = 8, g = grid(W, H);
  for (const x of [1, 6, 11, 14]) vline(g, x, 3, 5, x % 2 ? POLE : POLE_L);
  if (b.stage >= 1) for (let x = 0; x < W; x++) { put(g, x, 2, x % 3 === 2 ? M.plank[2] : M.plank[1]); put(g, x, 3, M.plank[2]); if (hash2(x, 0, seed) < 0.1) put(g, x, 2, M.plank[0]); }
  if (b.stage >= 2) hline(g, 0, 1, W, POLE_L);
  return g;
}
function road(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 141 + v, W = 10, H = 5, g = grid(W, H);
  for (let x = 0; x < W; x++) for (let y = 1; y < H; y++) { const hh = hash2(x, y, seed); if (hh < 0.15) continue; put(g, x, y, (x + y) % 2 ? M.stone[1] : hh > 0.8 ? M.stone[0] : M.stone[2]); }
  void b;
  return g;
}
function bridge(b: BuildingLooks): Grid {
  const v = b.v & 3, seed = 151 + v, W = 12, H = 6, g = grid(W, H);
  for (let x = 0; x < W; x++) { put(g, x, 1, M.timber[0]); put(g, x, 2, hash2(x, 2, seed) < 0.5 ? M.timber[1] : M.timber[2]); put(g, x, 3, POLE); }
  for (const x of [1, W - 2]) { put(g, x, 0, POLE_L); vline(g, x, 3, 3, POLE); }
  void b;
  return g;
}
function shrine(b: BuildingLooks): Grid {
  const v = b.v & 3, g = house({ ...b, style: "cone", size: 1, windows: 0 });
  /* a carved post before the door, in the people's dyes */
  const x = 2;
  for (let y = g.h - 10; y < g.h; y++) put(g, x, y, (y + v) % 3 === 0 ? b.trim : (y + v) % 3 === 1 ? shade(b.trim, 0.15) : POLE);
  put(g, x - 1, g.h - 10, b.trim); put(g, x + 1, g.h - 10, b.trim);
  return g;
}
/** Which stage and wear a building shows, from how far built it is and its state. */
export function buildingStage(prog: number, state: number): { stage: number; wear: number } {
  return { stage: prog < 0.4 ? 0 : prog < 1 ? 1 : 2, wear: prog < 1 ? 0 : state < 0.2 ? 2 : state < 0.55 ? 1 : 0 };
}
